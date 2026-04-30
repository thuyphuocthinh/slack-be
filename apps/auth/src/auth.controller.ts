import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import { AUTH_MESSAGE_PATTERNS } from '@slack/constants';
import {
  LoginDto,
  RegisterDto,
  VerifyEmailDto,
  RefreshTokenDto,
  VerifyResetPasswordDto,
  ResetPasswordDto,
} from './dto';
import { IRequestMetadata } from '@slack/common';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern(AUTH_MESSAGE_PATTERNS.REGISTER)
  register(@Payload() data: RegisterDto) {
    return this.authService.register(data);
  }

  @MessagePattern(AUTH_MESSAGE_PATTERNS.VERIFY_EMAIL)
  verifyEmail(@Payload() data: VerifyEmailDto) {
    return this.authService.verifyEmail(data);
  }

  @MessagePattern(AUTH_MESSAGE_PATTERNS.LOGIN)
  login(@Payload() payload: { data: LoginDto; metadata?: IRequestMetadata }) {
    return this.authService.login(payload.data, payload.metadata);
  }

  @MessagePattern(AUTH_MESSAGE_PATTERNS.REFRESH)
  refresh(
    @Payload() payload: { data: RefreshTokenDto; metadata?: IRequestMetadata },
  ) {
    return this.authService.refresh(payload.data, payload.metadata);
  }

  @MessagePattern(AUTH_MESSAGE_PATTERNS.LOGIN_GOOGLE)
  loginGoogle(
    @Payload()
    payload: {
      data: { email: string };
      metadata?: IRequestMetadata;
    },
  ) {
    return this.authService.loginGoogle(payload.data, payload.metadata);
  }

  @MessagePattern(AUTH_MESSAGE_PATTERNS.LOGOUT)
  logout(
    @Payload() payload: { data: { accessToken: string; refreshToken: string } },
  ) {
    return this.authService.logout(payload.data);
  }

  @MessagePattern(AUTH_MESSAGE_PATTERNS.LOGOUT_ALL)
  logoutAll(@Payload() payload: { data: { accessToken: string } }) {
    return this.authService.logoutAll(payload.data);
  }

  @MessagePattern(AUTH_MESSAGE_PATTERNS.FORGOT_PASSWORD)
  forgotPassword(@Payload() payload: { data: { email: string } }) {
    return this.authService.forgotPassword(payload.data);
  }

  @MessagePattern(AUTH_MESSAGE_PATTERNS.VERIFY_RESET_PASSWORD)
  verifyResetPassword(@Payload() payload: { data: VerifyResetPasswordDto }) {
    return this.authService.verifyResetPassword(payload.data);
  }

  @MessagePattern(AUTH_MESSAGE_PATTERNS.RESET_PASSWORD)
  resetPassword(@Payload() payload: { data: ResetPasswordDto }) {
    return this.authService.resetPassword(payload.data);
  }

  @MessagePattern(AUTH_MESSAGE_PATTERNS.VERIFY_OTP_FROM_AUTHENTICATOR)
  verifyOtpFromAuthenticator(
    @Payload()
    payload: {
      data: { tempToken: string; otp: string };
      metadata?: IRequestMetadata;
    },
  ) {
    return this.authService.verifyOtpFromAuthenticator(
      payload.data.tempToken,
      payload.data.otp,
      payload.metadata,
    );
  }

  @MessagePattern(AUTH_MESSAGE_PATTERNS.VERIFY_PASSWORD_FOR_UPDATE)
  verifyPassword(@Payload() payload: { data: LoginDto }) {
    return this.authService.verifyPassword(payload.data);
  }

  @MessagePattern(AUTH_MESSAGE_PATTERNS.CHANGE_PASSWORD)
  changePassword(@Payload() payload: { data: LoginDto }) {
    return this.authService.changePassword(payload.data);
  }
}
