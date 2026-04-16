import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { MoreThan, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { AuthEntity, ProviderType } from './entity/auth.entity';
import { SessionEntity } from './entity/session.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { LoginDto, RegisterDto, VerifyEmailDto, RefreshTokenDto, ResetPasswordDto, VerifyResetPasswordDto } from './dto';
import * as bcrypt from 'bcrypt';
import {
  AUTH_ERROR,
  NAME_SERVICE_TCP,
  NOTIFICATION_MESSAGE_PATTERNS,
  USER_MESSAGE_PATTERNS,
} from '@slack/constants';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  VerificationAction,
  VerificationEntity,
} from './entity/verification.entity';
import { v7 } from 'uuid';
import { firstValueFrom } from 'rxjs';
import { ITokenResponse } from './types/auth.response';
import { IRequestMetadata } from '@slack/common';
import { AuthCacheService } from '@slack/cached';
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

    const hashPassword = await bcrypt.hash(password, 10);

    // 2. create user (FIX: dùng firstValueFrom thay toPromise)
    const newUser = await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.CREATE_USER, { email }),
    );

    // 3. create auth
    const newAuth = this.authRepository.create({
      providerId: email,
      providerType: ProviderType.LOCAL,
      password: hashPassword,
      userId: newUser.id,
    });

    await this.authRepository.save(newAuth);
    this.logger.log(`Create auth with info ${JSON.stringify(newAuth)}`);

    // 4. generate verification
    const verification = this.verificationRepository.create({
      code: v7(),
      userId: newUser.id,
      action: VerificationAction.VERIFY_EMAIL,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 phút
    });

    await this.verificationRepository.save(verification);

    // 5. send email (fire-and-forget)
    this.notificationClient.emit(
      NOTIFICATION_MESSAGE_PATTERNS.SEND_VERIFICATION_EMAIL,
      {
        email,
        code: verification.code,
      },
    );

    // 6. response
    return 'We have sent you a verification email. Please check your inbox to verify your account.';
  }

  async verifyEmail(request: VerifyEmailDto): Promise<string> {
    const { code } = request;

    // 1. Find verification by code only
    const verification = await this.verificationRepository.findOne({
      where: {
        code,
        action: VerificationAction.VERIFY_EMAIL,
        isUsed: false
      },
    });

    if (!verification) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_INVALID_VERIFICATION_CODE);
    }

    if (verification.expiresAt.getTime() < Date.now()) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_VERIFICATION_CODE_EXPIRED);
    }

    // 2. Find user auth to ensure it exists for this verification
    const auth = await this.authRepository.findOne({
      where: {
        userId: verification.userId,
        providerType: ProviderType.LOCAL,
      },
    });

    if (!auth) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_NOT_FOUND);
    }

    // 3. Mark as used
    verification.isUsed = true;
    await this.verificationRepository.save(verification);

    // 4. Update user status
    this.userClient.emit(USER_MESSAGE_PATTERNS.CHANGE_USER_STATUS, {
      id: auth.userId,
      status: 'active',
    });

    return 'Email successfully verified.';
  }

  private async generateTokens(userId: string, email: string): Promise<ITokenResponse> {
    const tokenVersion = await this.authCacheService.getUserTokenVersion(userId);
    const accessToken = await this.jwtService.signAsync({ sub: userId, email, tokenVersion }, { expiresIn: '15m' });
    const refreshToken = await this.jwtService.signAsync({ sub: userId, email, tokenVersion }, { expiresIn: '7d' });
    await this.authCacheService.blacklistToken(accessToken, 15 * 60);
    return { accessToken, refreshToken, type: 'Bearer' };
  }

  async login(
    request: LoginDto,
    metadata?: IRequestMetadata
  ): Promise<ITokenResponse> {
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

    // 4. generate access token + refresh token
    const { accessToken, refreshToken } = await this.generateTokens(auth.userId, email);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // 4. create session
    const session = this.sessionRepository.create({
      userId: auth.userId,
      refreshToken,
      expiresAt: expiresAt,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      device: metadata?.device,
    });

    await this.sessionRepository.save(session);

    // 5. return tokens
    return {
      accessToken,
      refreshToken,
      type: 'Bearer',
    };
  }

  async refresh(
    request: RefreshTokenDto,
    metadata?: IRequestMetadata
  ): Promise<ITokenResponse> {
    const { refreshToken } = request;

    // 1. Verify token format and expiration
    try {
      await this.jwtService.verifyAsync(refreshToken);
    } catch {
      throw new RpcException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
    }

    // 2. verify token exists in db and hasn't been revoked
    const session = await this.sessionRepository.findOne({
      where: {
        refreshToken,
        isRevoked: false,
      },
    });

    if (!session || session.expiresAt.getTime() < Date.now()) {
      throw new RpcException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
    }

    // 3. fetch auth entity for sub/email (or decode from token payload)
    const payload = this.jwtService.decode(refreshToken) as any;
    const email = payload?.email;

    if (!email) {
      throw new RpcException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
    }

    // 4. Invalidate old token
    session.isRevoked = true;
    await this.sessionRepository.save(session);

    // 5. generate new pair
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await this.generateTokens(session.userId, email);

    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 7);

    // 6. create new session
    const newSession = this.sessionRepository.create({
      userId: session.userId,
      refreshToken: newRefreshToken,
      expiresAt: newExpiresAt,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      device: metadata?.device,
    });
    await this.sessionRepository.save(newSession);

    // 7. return
    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      type: 'Bearer',
    };
  }

  // login google - fix later
  async loginGoogle(request: { email: string }, metadata?: IRequestMetadata): Promise<ITokenResponse> {
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
    const { accessToken, refreshToken } = await this.generateTokens(auth.userId, email);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const session = this.sessionRepository.create({
      userId: auth.userId,
      refreshToken,
      expiresAt: expiresAt,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      device: metadata?.device,
    });
    await this.sessionRepository.save(session);
    return {
      accessToken,
      refreshToken,
      type: 'Bearer',
    };
  }

  // logout
  async logout(request: { refreshToken: string }): Promise<string> {
    const { refreshToken } = request;
    const session = await this.sessionRepository.findOne({
      where: {
        refreshToken,
        isRevoked: false,
      },
    });
    if (!session) {
      throw new RpcException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
    }
    session.isRevoked = true;
    await this.sessionRepository.save(session);
    return 'Logout successfully.';
  }

  // logout all
  async logoutAll(request: { userId: string }): Promise<string> {
    const { userId } = request;
    const sessions = await this.sessionRepository.find({
      where: {
        userId,
        isRevoked: false,
      },
    });
    if (!sessions) {
      throw new RpcException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
    }
    sessions.forEach((session) => {
      session.isRevoked = true;
    });
    await this.sessionRepository.save(sessions);
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
    this.notificationClient.emit(
      NOTIFICATION_MESSAGE_PATTERNS.SEND_RESET_PASSWORD_EMAIL,
      {
        email,
        code: verification.code,
      },
    );
    return 'Check your email to verify your email.';
  }

  // verify reset password
  async verifyResetPassword(request: VerifyResetPasswordDto): Promise<string> {
    const { email, code } = request;
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
    const verification = await this.verificationRepository.findOne({
      where: {
        userId: auth.userId,
        code,
        action: VerificationAction.RESET_PASSWORD,
        isUsed: false,
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!verification) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_VERIFICATION_CODE_EXPIRED);
    }
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
    const verification = await this.verificationRepository.findOne({
      where: {
        userId: auth.userId,
        code,
        action: VerificationAction.RESET_PASSWORD,
        isUsed: false,
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!verification) {
      throw new RpcException(AUTH_ERROR.ACCOUNT_VERIFICATION_CODE_EXPIRED);
    }
    // 3. update password
    const hashedPassword = await bcrypt.hash(password, 10);
    auth.password = hashedPassword;
    await this.authRepository.save(auth);

    // 4. mark verification as used
    verification.isUsed = true;
    await this.verificationRepository.save(verification);
    return 'Reset password successfully.';
  }
}
