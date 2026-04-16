import { Body, Controller, Get, Post, Query, Ip, Headers, Res, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, VerifyEmailDto, RefreshTokenDto } from './dto';
import { Public } from '@slack/common';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Public()
  @Post('register')
  register(@Body() data: RegisterDto) {
    return this.authService.register(data);
  }

  @Public()
  @Get('verify-email')
  verifyEmail(@Query() data: VerifyEmailDto) {
    return this.authService.verifyEmail(data);
  }

  @Public()
  @Post('login')
  login(
    @Body() data: LoginDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.authService.login(data, { ipAddress, userAgent, device: userAgent });
  }

  @Post('refresh')
  refresh(
    @Body() data: RefreshTokenDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.authService.refresh(data, { ipAddress, userAgent, device: userAgent });
  }

  @Post('logout')
  logout(@Body() data: { refreshToken: string }) {
    return this.authService.logout(data);
  }

  @Post('logout-all')
  logoutAll(@Body() data: { userId: string }) {
    return this.authService.logoutAll(data);
  }

  @Public()
  @Get("google")
  async googleLogin() {
    // passport tự redirect → không cần code gì ở đây
  }

  @Public()
  @Get("google/callback")
  async googleCallback(
    @Req() req: any,
    @Res() res: any,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    const {
      profile,
    } = req.user;

    const email = profile?.emails?.[0]?.value;

    if (!email) {
      // Handle the case where Google didn't return an email
      return res.status(400).json({ message: 'No email found from Google profile' });
    }

    const tokens = await this.authService.loginGoogle(
      { email },
      { ipAddress, userAgent, device: userAgent }
    );

    // TODO: Typically in OAuth callbacks for web apps, you would redirect to the
    // frontend with the tokens in the URL or set them in an HTTP-only cookie.
    // For now, we just return the tokens as JSON.
    // E.g.: return res.redirect(`http://localhost:3000/auth/success?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}`);

    return res.json(tokens);
  }
}
