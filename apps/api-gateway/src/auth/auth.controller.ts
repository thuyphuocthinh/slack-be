import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Ip,
  Headers,
  Res,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RegisterDto,
  VerifyEmailDto,
  RefreshTokenDto,
  VerifyResetPasswordDto,
  ResetPasswordDto,
  VerifyOtpFromAuthenticatorDto,
} from './dto';
import { Public } from '@slack/common';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User successfully registered' })
  register(@Body() data: RegisterDto) {
    return this.authService.register(data);
  }

  @Public()
  @Get('verify-email')
  @ApiOperation({ summary: 'Verify user email' })
  @ApiResponse({ status: 200, description: 'Email successfully verified' })
  verifyEmail(@Query() data: VerifyEmailDto) {
    return this.authService.verifyEmail(data);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({
    status: 200,
    description: 'User successfully logged in, returns tokens',
  })
  login(
    @Body() data: LoginDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.authService.login(data, {
      ipAddress,
      userAgent,
      device: userAgent,
    });
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Tokens successfully refreshed' })
  @ApiBearerAuth()
  refresh(
    @Body() data: RefreshTokenDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.authService.refresh(data, {
      ipAddress,
      userAgent,
      device: userAgent,
    });
  }

  @Post('logout')
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({ status: 200, description: 'User successfully logged out' })
  @ApiBearerAuth()
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
      },
    },
  })
  logout(@Body() data: { accessToken: string; refreshToken: string }) {
    return this.authService.logout(data);
  }

  @Post('logout-all')
  @ApiOperation({ summary: 'Logout user from all devices' })
  @ApiResponse({
    status: 200,
    description: 'User successfully logged out from all devices',
  })
  @ApiBearerAuth()
  @ApiBody({
    schema: { type: 'object', properties: { userId: { type: 'string' } } },
  })
  logoutAll(@Body() data: { userId: string }) {
    return this.authService.logoutAll(data);
  }

  @Public()
  @Get('google')
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  async googleLogin() {
    // passport tự redirect → không cần code gì ở đây
  }

  @Public()
  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback' })
  @ApiResponse({
    status: 200,
    description: 'Google login successful, returns tokens',
  })
  async googleCallback(
    @Req() req: any,
    @Res() res: any,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    const { profile } = req.user;

    const email = profile?.emails?.[0]?.value;

    if (!email) {
      // Handle the case where Google didn't return an email
      return res
        .status(400)
        .json({ message: 'No email found from Google profile' });
    }

    const tokens = await this.authService.loginGoogle(
      { email },
      { ipAddress, userAgent, device: userAgent },
    );

    // TODO: Typically in OAuth callbacks for web apps, you would redirect to the
    // frontend with the tokens in the URL or set them in an HTTP-only cookie.
    // For now, we just return the tokens as JSON.
    // E.g.: return res.redirect(`http://localhost:3000/auth/success?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}`);

    return res.json(tokens);
  }

  @Public()
  @Post('forgot-password')
  @ApiOperation({ summary: 'Request password reset email' })
  @ApiResponse({ status: 200, description: 'Password reset email sent' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { email: { type: 'string', example: 'user@example.com' } },
    },
  })
  forgotPassword(@Body() data: { email: string }) {
    return this.authService.forgotPassword(data);
  }

  @Public()
  @Get('verify-reset-password')
  @ApiOperation({ summary: 'Verify reset password code' })
  @ApiResponse({ status: 200, description: 'Reset password code is valid' })
  verifyResetPassword(@Query() data: VerifyResetPasswordDto) {
    return this.authService.verifyResetPassword(data);
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset user password' })
  @ApiResponse({ status: 200, description: 'Password successfully reset' })
  resetPassword(@Body() data: ResetPasswordDto) {
    return this.authService.resetPassword(data);
  }

  @Public()
  @Post('verify-otp-from-authenticator')
  @ApiOperation({ summary: 'Verify OTP from authenticator' })
  @ApiResponse({ status: 200, description: 'OTP verified successfully' })
  verifyOtpFromAuthenticator(
    @Body() data: VerifyOtpFromAuthenticatorDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.authService.verifyOtpFromAuthenticator(data, {
      ipAddress,
      userAgent,
      device: userAgent,
    });
  }
}
