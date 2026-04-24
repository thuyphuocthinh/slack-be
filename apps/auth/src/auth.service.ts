import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { AuthEntity, ProviderType } from './entity/auth.entity';
import { SessionEntity } from './entity/session.entity';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LoginDto,
  RegisterDto,
  VerifyEmailDto,
  RefreshTokenDto,
  ResetPasswordDto,
  VerifyResetPasswordDto,
} from './dto';
import * as bcrypt from 'bcrypt';
import {
  AUTH_ERROR,
  NAME_SERVICE_TCP,
  TWO_FA_MESSAGE_PATTERNS,
  USER_MESSAGE_PATTERNS,
} from '@slack/constants';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  VerificationAction,
  VerificationEntity,
} from './entity/verification.entity';
import { v7 } from 'uuid';
import { firstValueFrom } from 'rxjs';
import { ITokenResponse, ITwoFactorResponse } from './types/auth.response';
import { hashToken, IRequestMetadata } from '@slack/common';
import { AuthCacheService } from '@slack/cached';
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
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.NOTIFICATION_SERVICE)
    private readonly notificationClient: ClientProxy,
    private readonly jwtService: JwtService,
    private readonly authCacheService: AuthCacheService,
    private readonly dataSource: DataSource,
    private readonly queueService: QueueService,
  ) {}

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

    // Optimization: reduce salt rounds for stress test performance
    const saltRounds = process.env.NODE_ENV === 'test' ? 4 : 10;
    const hashPassword = await bcrypt.hash(password, saltRounds);

    // 2. create user
    let newUser;
    try {
      newUser = await firstValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.CREATE_USER, { email }),
      );
    } catch (error) {
      this.logger.error(`Failed to create user for ${email}: ${error.message}`);
      throw new RpcException({
        statusCode: 500,
        message: 'Failed to create user service record',
      });
    }

    // 3. create auth and verification in transaction
    const verification = await this.dataSource.transaction(async (manager) => {
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

  async verifyEmail(request: VerifyEmailDto): Promise<string> {
    const { code } = request;

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
    this.userClient.emit(USER_MESSAGE_PATTERNS.CHANGE_USER_STATUS, {
      id: userId,
      status: 'active',
    });

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
    const { userId } = await this.jwtService.verifyAsync(tempToken);
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

    // 1. find auth by email
    const auth = await this.authRepository.findOne({
      where: {
        providerId: email,
        providerType: ProviderType.LOCAL,
      },
    });

    if (!auth) {
      throw new RpcException(AUTH_ERROR.INVALID_CREDENTIALS);
    }

    // 2. compare password
    const isPasswordValid = await bcrypt.compare(password, auth.password);
    if (!isPasswordValid) {
      throw new RpcException(AUTH_ERROR.INVALID_CREDENTIALS);
    }

    // 3. check user status
    const user = await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, {
        id: auth.userId,
      }),
    );

    if (user.status !== 'active') {
      throw new RpcException(AUTH_ERROR.ACCOUNT_NOT_VERIFIED);
    }

    // 4. check two factor
    const isEnableTwoFactor = await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.IS_USER_ENABLE_TWO_FACTOR, {
        userId: auth.userId,
      }),
    );

    if (isEnableTwoFactor) {
      return {
        isEnableTwoFactor: true,
        tempToken: await this.generateTempToken(auth.userId, email),
      };
    }

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

  // login google - fix later
  async loginGoogle(
    request: { email: string },
    metadata?: IRequestMetadata,
  ): Promise<ITokenResponse> {
    const { email } = request;
    let auth = await this.authRepository.findOne({
      where: {
        providerId: email,
        providerType: ProviderType.GOOGLE,
      },
    });
    if (!auth) {
      // create new user
      const newUser = await firstValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.CREATE_USER, { email }),
      );

      // create new auth
      const newAuth = this.authRepository.create({
        userId: newUser.id,
        providerId: email,
        providerType: ProviderType.GOOGLE,
        password: '',
      });

      auth = await this.authRepository.save(newAuth);
    }
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

  // logout
  async logout(request: {
    accessToken: string;
    refreshToken: string;
  }): Promise<string> {
    const { accessToken, refreshToken } = request;
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

    await this.authCacheService.blacklistToken(accessToken, 7 * 24 * 60 * 60);
    return 'Logout successfully.';
  }

  // logout all
  async logoutAll(request: { userId: string }): Promise<string> {
    const { userId } = request;
    await this.sessionRepository.update(
      {
        userId,
        isRevoked: false,
      },
      { isRevoked: true },
    );
    await this.authCacheService.bumpUserTokenVersion(userId);
    return 'Logout all successfully.';
  }

  // forgot passsword
  async forgotPassword(request: { email: string }): Promise<string> {
    const { email } = request;
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
    // 2. create verification
    const verification = this.verificationRepository.create({
      userId: auth.userId,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
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

  // verify reset password
  async verifyResetPassword(request: VerifyResetPasswordDto): Promise<string> {
    const { code } = request;
    // 1. find verification
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
    // 3. update verification
    verification.isUsed = true;
    await this.verificationRepository.save(verification);
    return 'Verify reset password successfully.';
  }

  // reset password
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

      const hashedPassword = await bcrypt.hash(password, 10);
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

  // verify password
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
    const isMatch = await bcrypt.compare(password, auth.password);
    return isMatch;
  }

  // change password
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
    const hashedPassword = await bcrypt.hash(password, 10);
    await this.authRepository.update(
      { id: auth.id },
      { password: hashedPassword },
    );
  }
}
