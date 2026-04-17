import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { AUTH_MESSAGE_PATTERNS, NAME_SERVICE_TCP } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import {
  LoginDto,
  RegisterDto,
  VerifyEmailDto,
  RefreshTokenDto,
  VerifyResetPasswordDto,
  VerifyOtpFromAuthenticatorDto,
} from './dto';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
import { IRequestMetadata } from '@slack/common';

@Injectable()
export class AuthService {
  constructor(
    @Inject(NAME_SERVICE_TCP.AUTH_SERVICE)
    private readonly authClient: ClientProxy,
  ) { }

  async register(data: RegisterDto): Promise<string> {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send<string>(AUTH_MESSAGE_PATTERNS.REGISTER, data),
        ),
      'register',
      'AuthService',
    );
  }

  async verifyEmail(data: VerifyEmailDto): Promise<string> {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send<string>(
            AUTH_MESSAGE_PATTERNS.VERIFY_EMAIL,
            data,
          ),
        ),
      'verifyEmail',
      'AuthService',
    );
  }

  async login(data: LoginDto, metadata: IRequestMetadata) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(AUTH_MESSAGE_PATTERNS.LOGIN, {
            data,
            metadata,
          }),
        ),
      'login',
      'AuthService',
    );
  }

  async refresh(data: RefreshTokenDto, metadata: IRequestMetadata) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(AUTH_MESSAGE_PATTERNS.REFRESH, {
            data,
            metadata,
          }),
        ),
      'refresh',
      'AuthService',
    );
  }

  async loginGoogle(data: { email: string }, metadata: IRequestMetadata) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(AUTH_MESSAGE_PATTERNS.LOGIN_GOOGLE, {
            data,
            metadata,
          }),
        ),
      'loginGoogle',
      'AuthService',
    );
  }

  async logout(data: { accessToken: string; refreshToken: string }) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(AUTH_MESSAGE_PATTERNS.LOGOUT, {
            data,
          }),
        ),
      'logout',
      'AuthService',
    );
  }

  async logoutAll(data: { userId: string }) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(AUTH_MESSAGE_PATTERNS.LOGOUT_ALL, {
            data,
          }),
        ),
      'logoutAll',
      'AuthService',
    );
  }

  async forgotPassword(data: { email: string }) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(AUTH_MESSAGE_PATTERNS.FORGOT_PASSWORD, {
            data,
          }),
        ),
      'forgotPassword',
      'AuthService',
    );
  }

  async verifyResetPassword(data: VerifyResetPasswordDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(AUTH_MESSAGE_PATTERNS.VERIFY_RESET_PASSWORD, {
            data,
          }),
        ),
      'verifyResetPassword',
      'AuthService',
    );
  }

  async resetPassword(data: VerifyResetPasswordDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(AUTH_MESSAGE_PATTERNS.RESET_PASSWORD, {
            data,
          }),
        ),
      'resetPassword',
      'AuthService',
    );
  }

  async verifyOtpFromAuthenticator(data: VerifyOtpFromAuthenticatorDto, metadata: IRequestMetadata) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(AUTH_MESSAGE_PATTERNS.VERIFY_OTP_FROM_AUTHENTICATOR, {
            data,
            metadata,
          }),
        ),
      'verifyOtpFromAuthenticator',
      'AuthService',
    );
  }
}
