import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { AuthEntity, ProviderType } from './entity/auth.entity';
import { SessionEntity } from './entity/session.entity';
import { UserDeviceEntity } from './entity/user-device.entity';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LoginDto,
  RegisterDto,
  VerifyEmailDto,
  RefreshTokenDto,
  ResetPasswordDto,
  VerifyResetPasswordDto,
  ResendCodeDto,
} from './dto';
import * as argon2 from 'argon2';
import {
  AUTH_ERROR,
  NAME_SERVICE_TCP,
  TWO_FA_MESSAGE_PATTERNS,
  USER_MESSAGE_PATTERNS,
  ESocketEvent,
} from '@slack/constants';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  VerificationAction,
  VerificationEntity,
} from './entity/verification.entity';
import { v7 } from 'uuid';
import { firstValueFrom } from 'rxjs';
import { ITokenResponse, ITwoFactorResponse } from './types/auth.response';
import { buildTTL, hashToken, IRequestMetadata } from '@slack/common';
import { AuthCacheService, PresenceCacheService } from '@slack/cached';
import { EJobName, EQueueName, QueueService } from '@slack/queue';
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(AuthEntity)
    private readonly authRepository: Repository<AuthEntity>,
    @InjectRepository(SessionEntity)
    private readonly sessionRepository: Repository<SessionEntity>,
    @InjectRepository(VerificationEntity)
    private readonly verificationRepository: Repository<VerificationEntity>,
    @InjectRepository(UserDeviceEntity)
    private readonly userDeviceRepository: Repository<UserDeviceEntity>,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    private readonly jwtService: JwtService,
    private readonly authCacheService: AuthCacheService,
    private readonly presenceCacheService: PresenceCacheService,
    private readonly dataSource: DataSource,
    private readonly queueService: QueueService,
  ) { }

  async register(request: RegisterDto): Promise<string> {
    const { email, password } = request;

    // 1. check auth tồn tại
    const existingAuth = await this.authRepository.findOneBy({
      providerId: email,
      providerType: ProviderType.LOCAL,
    });

    if (existingAuth) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_ALREADY_EXIST);
    }

    // Use argon2 for better security and performance (less event loop blocking)
    const hashPassword = await argon2.hash(password);

    // 2. create user
    let newUser;
    try {
      newUser = await firstValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.CREATE_USER, {
          email,
          status: 'pending',
        }),
      );
    } catch (error) {
      this.logger.error(`Failed to create user for ${email}: ${error.message}`);
      throw new RpcException({
        statusCode: 500,
        message: 'Failed to create user service record',
      });
    }

    // 3. create auth and verification in transaction
    let verification;
    try {
      verification = await this.dataSource.transaction(async (manager) => {
        const auth = manager.create(AuthEntity, {
          providerId: email,
          providerType: ProviderType.LOCAL,
          password: hashPassword,
          userId: newUser.id,
        });
        await manager.save(auth);

        const v = manager.create(VerificationEntity, {
          code: v7(),
          userId: newUser.id,
          action: VerificationAction.VERIFY_EMAIL,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 phút
        });
        return await manager.save(v);
      });
    } catch (error) {
      this.logger.error(
        `Failed to create auth record for ${email}. Rolling back user creation. Error: ${error.message}`,
      );
      // Compensating action: delete the newly created user
      await firstValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.DELETE_USER, {
          id: newUser.id,
        }),
      ).catch((err) => {
        this.logger.error(
          `Critical: Failed to rollback user creation for ${newUser.id}: ${err.message}`,
        );
      });
      throw error;
    }

    this.logger.log(`Register success for email ${email}`);

    // 5. send email (fire-and-forget)
    // this.notificationClient.emit(
    //   NOTIFICATION_MESSAGE_PATTERNS.SEND_VERIFICATION_EMAIL,
    //   {
    //     email,
    //     code: verification.code,
    //   },
    // );
    this.queueService
      .addJob(EQueueName.EMAIL_QUEUE, EJobName.SEND_VERIFICATION_EMAIL, {
        email,
        code: verification.code,
      })
      .catch((err) => {
        this.logger.error(
          `Failed to push verification email job for ${email}: ${err.message}`,
        );
      });

    // 6. response
    return 'We have sent you a verification email. Please check your inbox to verify your account.';
  }

  // verify code for register account
  async verifyEmail(request: VerifyEmailDto): Promise<string> {
    const { code } = request;

    this.logger.log(`Verifying email with code: ${code}`);

    // 1. Transaction to mark verification as used and verify user
    const userId = await this.dataSource.transaction(async (manager) => {
      const verification = await manager.findOne(VerificationEntity, {
        where: {
          code,
          action: VerificationAction.VERIFY_EMAIL,
          isUsed: false,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!verification) {
        throw new RpcException(AUTH_ERROR.ACCOUNT_INVALID_VERIFICATION_CODE);
      }

      if (verification.expiresAt.getTime() < Date.now()) {
        throw new RpcException(AUTH_ERROR.ACCOUNT_VERIFICATION_CODE_EXPIRED);
      }

      const auth = await manager.findOne(AuthEntity, {
        where: {
          userId: verification.userId,
          providerType: ProviderType.LOCAL,
        },
      });

      if (!auth) {
        throw new RpcException(AUTH_ERROR.ACCOUNT_NOT_FOUND);
      }

      verification.isUsed = true;
      await manager.save(verification);

      return auth.userId;
    });

    // 4. Update user status
    await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.CHANGE_USER_STATUS, {
        id: userId,
        status: 'active',
      }),
    );

    return 'Email successfully verified.';
  }

  private async generateTokens(
    userId: string,
    email: string,
  ): Promise<ITokenResponse> {
    const tokenVersion =
      await this.authCacheService.getUserTokenVersion(userId);
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, email, tokenVersion },
      { expiresIn: '30m' },
    );
    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, email, tokenVersion, jti: v7() },
      { expiresIn: '7d' },
    );
    return { accessToken, refreshToken, type: 'Bearer' };
  }

  private async createSession(
    userId: string,
    refreshToken: string,
    metadata?: IRequestMetadata,
  ) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const session = this.sessionRepository.create({
      userId,
      refreshToken: hashToken(refreshToken),
      expiresAt: expiresAt,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      device: metadata?.device,
    });
    await this.sessionRepository.save(session);
  }

  private async handleDeviceTracking(userId: string, email: string, metadata?: IRequestMetadata) {
    if (!metadata?.device) return;

    const existingDevice = await this.userDeviceRepository.findOne({
      where: { userId, deviceId: metadata.device },
    });

    if (!existingDevice) {
      // 1. New device! Save it.
      const newDevice = this.userDeviceRepository.create({
        userId,
        deviceId: metadata.device,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        isTrusted: false,
      });
      await this.userDeviceRepository.save(newDevice);

      // Generate secure token
      const secureToken = await this.jwtService.signAsync(
        { sub: userId, deviceId: metadata.device, type: 'SECURE_ACCOUNT' },
        { expiresIn: '1h' },
      );

      // 2. Queue Email Alert
      this.queueService
        .addJob(EQueueName.EMAIL_QUEUE, EJobName.SEND_UNRECOGNIZED_DEVICE_EMAIL, {
          email,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
          time: new Date().toISOString(),
          secureToken,
        })
        .catch((err) => {
          this.logger.error(`Failed to push device alert email for ${email}: ${err.message}`);
        });
    } else {
      // Update last login info
      existingDevice.lastLoginAt = new Date();
      if (metadata.ipAddress) existingDevice.ipAddress = metadata.ipAddress;
      if (metadata.userAgent) existingDevice.userAgent = metadata.userAgent;
      await this.userDeviceRepository.save(existingDevice);
    }
  }

  private async generateTempToken(
    userId: string,
    email: string,
  ): Promise<string> {
    const tempToken = await this.jwtService.signAsync(
      { sub: userId, email, state: '2FA_OTP_IS_BEING_VERIFIED' },
      { expiresIn: '5m' },
    );
    return tempToken;
  }

  async verifyOtpFromAuthenticator(
    tempToken: string,
    otp: string,
    metadata?: IRequestMetadata,
  ): Promise<ITokenResponse> {
    const payload = await this.jwtService.verifyAsync(tempToken);
    if (payload.state !== '2FA_OTP_IS_BEING_VERIFIED') {
      throw new RpcException(AUTH_ERROR.INVALID_ACCESS_TOKEN);
    }
    const userId = payload.sub;
    await firstValueFrom(
      this.userClient.send(TWO_FA_MESSAGE_PATTERNS.VERIFY_OTP, {
        userId,
        otp,
      }),
    );

    const user = await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, {
        id: userId,
      }),
    );

    if (!user) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_NOT_FOUND);
    }

    const { accessToken, refreshToken } = await this.generateTokens(
      user.id,
      user.email,
    );

    await this.createSession(user.id, refreshToken, metadata);

    return { accessToken, refreshToken, type: 'Bearer' };
  }

  async login(
    request: LoginDto,
    metadata?: IRequestMetadata,
  ): Promise<ITokenResponse | ITwoFactorResponse> {
    const { email, password } = request;

    // 1 & 3. Fetch auth data and user profile in parallel
    const [auth, user] = await Promise.all([
      this.authRepository.findOne({
        where: {
          providerId: email,
          providerType: ProviderType.LOCAL,
        },
      }),
      firstValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_EMAIL, {
          email,
        }),
      ).catch(() => null),
    ]);

    if (!auth || !user) {
      throw new RpcException(AUTH_ERROR.INVALID_CREDENTIALS);
    }

    // 2. compare password
    const isPasswordValid = await argon2.verify(auth.password, password);
    this.logger.log(`Password valid: ${isPasswordValid}`);
    if (!isPasswordValid) {
      throw new RpcException(AUTH_ERROR.INVALID_CREDENTIALS);
    }

    if (user.status !== 'active') {
      throw new RpcException(AUTH_ERROR.ACCOUNT_NOT_VERIFIED);
    }

    this.logger.log(`User ${email} 2FA enabled: ${user.isTwoFactorEnabled}`);
    if (user.isTwoFactorEnabled) {
      return {
        isEnableTwoFactor: true,
        tempToken: await this.generateTempToken(auth.userId, email),
      };
    }

    // 4. device tracking
    await this.handleDeviceTracking(auth.userId, email, metadata);

    // 5. generate access token + refresh token
    const { accessToken, refreshToken } = await this.generateTokens(
      auth.userId,
      email,
    );

    // 5. create session
    await this.createSession(auth.userId, refreshToken, metadata);

    // 6. return tokens
    return {
      accessToken,
      refreshToken,
      type: 'Bearer',
    };
  }

  async refresh(
    request: RefreshTokenDto,
    metadata?: IRequestMetadata,
  ): Promise<ITokenResponse> {
    const { refreshToken } = request;

    // 1. Verify token format and expiration
    try {
      await this.jwtService.verifyAsync(refreshToken);
    } catch {
      throw new RpcException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
    }

    // 2. Transaction to handle rotation atomicity and race conditions
    const { newAccessToken, newRefreshToken } =
      await this.dataSource.transaction(async (manager) => {
        const session = await manager.findOne(SessionEntity, {
          where: {
            refreshToken: hashToken(refreshToken),
            isRevoked: false,
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (!session || session.expiresAt.getTime() < Date.now()) {
          throw new RpcException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
        }

        const payload = this.jwtService.decode(refreshToken) as any;
        const email = payload?.email;

        if (!email) {
          throw new RpcException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
        }

        // Invalidate old token
        session.isRevoked = true;
        await manager.save(session);

        // generate new pair
        const tokens = await this.generateTokens(session.userId, email);

        // create new session within the same transaction
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        const newSession = manager.create(SessionEntity, {
          userId: session.userId,
          refreshToken: hashToken(tokens.refreshToken),
          expiresAt,
          ipAddress: metadata?.ipAddress,
          userAgent: metadata?.userAgent,
          device: metadata?.device,
        });
        await manager.save(newSession);

        return {
          newAccessToken: tokens.accessToken,
          newRefreshToken: tokens.refreshToken,
        };
      });

    // 7. return
    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      type: 'Bearer',
    };
  }

  async loginGoogle(
    request: { email: string },
    metadata?: IRequestMetadata,
  ): Promise<ITokenResponse | ITwoFactorResponse> {
    const { email } = request;
    let auth = await this.authRepository.findOne({
      where: {
        providerId: email,
        providerType: ProviderType.GOOGLE,
      },
    });

    let user;
    if (!auth) {
      // create new user
      user = await firstValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.CREATE_USER, {
          email,
          status: 'active',
        }),
      );

      // create new auth
      const newAuth = this.authRepository.create({
        userId: user.id,
        providerId: email,
        providerType: ProviderType.GOOGLE,
        password: '',
      });

      auth = await this.authRepository.save(newAuth);
    } else {
      user = await firstValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, {
          id: auth.userId,
        }),
      );
    }

    if (!user) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_NOT_FOUND);
    }

    if (user.isTwoFactorEnabled) {
      return {
        isEnableTwoFactor: true,
        tempToken: await this.generateTempToken(auth.userId, email),
      };
    }

    // 4. device tracking
    await this.handleDeviceTracking(auth.userId, email, metadata);

    const { accessToken, refreshToken } = await this.generateTokens(
      auth.userId,
      email,
    );
    // 5. create session
    await this.createSession(auth.userId, refreshToken, metadata);
    return {
      accessToken,
      refreshToken,
      type: 'Bearer',
    };
  }

  async logout(request: {
    accessToken: string;
    refreshToken: string;
  }): Promise<string> {
    const { accessToken, refreshToken } = request;

    if (!refreshToken) {
      throw new RpcException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
    }

    if (!accessToken) {
      throw new RpcException(AUTH_ERROR.INVALID_ACCESS_TOKEN);
    }

    const result = await this.sessionRepository.update(
      {
        refreshToken: hashToken(refreshToken),
        isRevoked: false,
        expiresAt: MoreThan(new Date()),
      },
      { isRevoked: true },
    );

    if (result.affected === 0) {
      throw new RpcException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
    }

    await this.authCacheService.blacklistToken(
      accessToken,
      buildTTL('MINUTE', 30),
    );

    try {
      const payload = await this.jwtService.verifyAsync(accessToken);
      const userId = payload.sub;
      await this.presenceCacheService.removeStatus(userId);
    } catch (err) {
      this.logger.warn(`Failed to remove presence status on logout: ${err.message}`);
    }

    return 'Logout successfully.';
  }

  async logoutAll(request: { accessToken: string }): Promise<string> {
    const { accessToken } = request;

    if (!accessToken) {
      throw new RpcException(AUTH_ERROR.INVALID_ACCESS_TOKEN);
    }

    try {
      const payload = await this.jwtService.verifyAsync(accessToken);
      const userId = payload.sub;

      await this.sessionRepository.update(
        {
          userId,
          isRevoked: false,
        },
        { isRevoked: true },
      );
      await this.authCacheService.bumpUserTokenVersion(userId);
      await this.presenceCacheService.removeStatus(userId);
      return 'Logout all successfully.';
    } catch (error) {
      this.logger.error(`Logout all failed: ${error.message}`);
      throw new RpcException(AUTH_ERROR.INVALID_ACCESS_TOKEN);
    }
  }

  async forgotPassword(request: { email: string }): Promise<string> {
    const { email } = request;
    const auth = await this.authRepository.findOne({
      where: {
        providerId: email,
        providerType: ProviderType.LOCAL,
      },
    });
    if (!auth) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_NOT_FOUND);
    }
    // 2. create verification
    const verification = this.verificationRepository.create({
      userId: auth.userId,
      expiresAt: new Date(Date.now() + buildTTL('MINUTE', 5)),
      code: v7(),
      action: VerificationAction.RESET_PASSWORD,
    });

    await this.verificationRepository.save(verification);

    // 3. send email
    // this.notificationClient.emit(
    //   NOTIFICATION_MESSAGE_PATTERNS.SEND_RESET_PASSWORD_EMAIL,
    //   {
    //     email,
    //     code: verification.code,
    //   },
    // );
    this.queueService
      .addJob(EQueueName.EMAIL_QUEUE, EJobName.SEND_PASSWORD_RESET_EMAIL, {
        email,
        code: verification.code,
      })
      .catch((err) => {
        this.logger.error(
          `Failed to push password reset email job for ${email}: ${err.message}`,
        );
      });

    return 'Check your email to verify your email.';
  }

  // verify code for forgot password
  async verifyResetPassword(request: VerifyResetPasswordDto): Promise<string> {
    const { code } = request;
    const verification = await this.verificationRepository.findOne({
      where: {
        code,
        action: VerificationAction.RESET_PASSWORD,
        isUsed: false,
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!verification) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_VERIFICATION_CODE_EXPIRED);
    }
    // 2. find user
    const user = await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, {
        id: verification.userId,
      }),
    );
    if (!user) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_NOT_FOUND);
    }
    return 'Verify reset password successfully.';
  }

  async resetPassword(request: ResetPasswordDto): Promise<string> {
    const { email, code, password } = request;
    // 1. find auth by email
    const auth = await this.authRepository.findOne({
      where: {
        providerId: email,
        providerType: ProviderType.LOCAL,
      },
    });
    if (!auth) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_NOT_FOUND);
    }
    // 2. find verification
    await this.dataSource.transaction(async (manager) => {
      const verification = await manager.findOne(VerificationEntity, {
        where: {
          userId: auth.userId,
          code,
          action: VerificationAction.RESET_PASSWORD,
          isUsed: false,
          expiresAt: MoreThan(new Date()),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!verification) {
        throw new RpcException(AUTH_ERROR.ACCOUNT_VERIFICATION_CODE_EXPIRED);
      }

      const hashedPassword = await argon2.hash(password);
      await manager.update(
        AuthEntity,
        { id: auth.id },
        { password: hashedPassword },
      );

      verification.isUsed = true;
      await manager.save(verification);
    });
    return 'Reset password successfully.';
  }

  async verifyPassword(request: {
    email: string;
    password: string;
  }): Promise<boolean> {
    const { email, password } = request;
    const auth = await this.authRepository.findOne({
      where: {
        providerId: email,
        providerType: ProviderType.LOCAL,
      },
    });
    if (!auth) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_NOT_FOUND);
    }
    const isMatch = await argon2.verify(auth.password, password);
    return isMatch;
  }

  async changePassword(request: {
    email: string;
    password: string;
  }): Promise<void> {
    const { email, password } = request;
    const auth = await this.authRepository.findOne({
      where: {
        providerId: email,
        providerType: ProviderType.LOCAL,
      },
    });
    if (!auth) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_NOT_FOUND);
    }
    const hashedPassword = await argon2.hash(password);
    await this.authRepository.update(
      { id: auth.id },
      { password: hashedPassword },
    );
  }

  async resendCode(request: ResendCodeDto): Promise<string> {
    const { email, action } = request;

    // Use transaction to ensure atomicity and avoid race conditions
    const { code } = await this.dataSource.transaction(async (manager) => {
      const auth = await manager.findOne(AuthEntity, {
        where: { providerId: email, providerType: ProviderType.LOCAL },
      });

      if (!auth) {
        throw new RpcException(AUTH_ERROR.ACCOUNT_NOT_FOUND);
      }

      // Upsert pattern: Find active verification with lock or create a new instance
      const verification =
        (await manager.findOne(VerificationEntity, {
          where: {
            userId: auth.userId,
            action: action as VerificationAction,
            isUsed: false,
            expiresAt: MoreThan(new Date()),
          },
          lock: { mode: 'pessimistic_write' },
        })) ||
        manager.create(VerificationEntity, {
          userId: auth.userId,
          action: action as VerificationAction,
        });

      const newCode = v7();
      Object.assign(verification, {
        code: newCode,
        expiresAt: new Date(Date.now() + buildTTL('MINUTE', 5)),
      });

      await manager.save(verification);
      return { code: newCode };
    });

    const JOB_MAP: Record<VerificationAction, EJobName> = {
      [VerificationAction.VERIFY_EMAIL]: EJobName.SEND_VERIFICATION_EMAIL,
      [VerificationAction.RESET_PASSWORD]: EJobName.SEND_PASSWORD_RESET_EMAIL,
    };

    const jobName = JOB_MAP[action as VerificationAction];
    if (jobName) {
      this.queueService
        .addJob(EQueueName.EMAIL_QUEUE, jobName, { email, code })
        .catch((err) => {
          this.logger.error(
            `Failed to push ${jobName} job for ${email}: ${err.message}`,
          );
        });
    }

    return 'Resend code successfully.';
  }

  async secureAccount(token: string): Promise<string> {
    let payload;
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new RpcException(AUTH_ERROR.INVALID_ACCESS_TOKEN);
    }

    if (payload.type !== 'SECURE_ACCOUNT') {
      throw new RpcException(AUTH_ERROR.INVALID_ACCESS_TOKEN);
    }

    const userId = payload.sub;
    const deviceId = payload.deviceId;

    // 1. Revoke all sessions for user
    await this.sessionRepository.update(
      { userId, isRevoked: false },
      { isRevoked: true },
    );
    await this.authCacheService.bumpUserTokenVersion(userId);
    await this.presenceCacheService.removeStatus(userId);

    // Force disconnect all active websockets for this user immediately
    this.queueService
      .addJob(EQueueName.SOCKET_QUEUE, EJobName.EMIT_TO_USERS, {
        event: ESocketEvent.FORCE_LOGOUT,
        userIds: [userId],
        data: { reason: 'secure_account' },
      })
      .catch((err) => {
        this.logger.error(
          `Failed to push force_logout socket event: ${err.message}`,
        );
      });

    // 2. Mark device as untrusted
    await this.userDeviceRepository.update(
      { userId, deviceId },
      { isTrusted: false },
    );

    // 3. Force password reset
    const auth = await this.authRepository.findOne({
      where: { userId, providerType: ProviderType.LOCAL },
    });

    if (auth) {
      const verification = this.verificationRepository.create({
        userId: auth.userId,
        expiresAt: new Date(Date.now() + buildTTL('MINUTE', 5)),
        code: v7(),
        action: VerificationAction.RESET_PASSWORD,
      });
      await this.verificationRepository.save(verification);

      const user = await firstValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, {
          id: userId,
        }),
      ).catch(() => null);

      if (user && user.email) {
        this.queueService
          .addJob(EQueueName.EMAIL_QUEUE, EJobName.SEND_PASSWORD_RESET_EMAIL, {
            email: user.email,
            code: verification.code,
          })
          .catch((err) => {
            this.logger.error(`Failed to push password reset email: ${err.message}`);
          });
      }
    }

    return 'Your account has been secured. All active sessions were terminated. Please check your email to reset your password.';
  }
}
