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
  Logger,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
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
  LogoutDto,
  LogoutAllDto,
  ResendCodeDto,
} from './dto';
import { Public } from '@slack/common';
import { RateLimit } from '../common/guards/rate-limit.decorator';
import { WorkspaceService } from '../workspace/workspace.service';
import { generateSamlRequest, parseSamlEmail } from './utils/sso.util';
import axios from 'axios';
import { Response } from 'express';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly workspaceService: WorkspaceService,
  ) { }

  @Public()
  @RateLimit({ limit: 3, window: 60 })
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
  @RateLimit({ limit: 5, window: 60 })
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
    @Headers('x-device-id') deviceId: string,
  ) {
    return this.authService.login(data, {
      ipAddress,
      userAgent,
      device: deviceId || userAgent,
    });
  }

  @Post('refresh')
  @Public()
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Tokens successfully refreshed' })
  refresh(
    @Body() data: RefreshTokenDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
    @Headers('x-device-id') deviceId: string,
  ) {
    return this.authService.refresh(data, {
      ipAddress,
      userAgent,
      device: deviceId || userAgent,
    });
  }

  @Post('logout')
  @ApiOperation({ summary: 'Logout user' })
  @ApiBody({ type: LogoutDto })
  @ApiResponse({ status: 200, description: 'User successfully logged out' })
  @ApiBearerAuth()
  logout(@Body() data: LogoutDto) {
    return this.authService.logout({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
  }

  @Post('logout-all')
  @ApiOperation({ summary: 'Logout user from all devices' })
  @ApiResponse({
    status: 200,
    description: 'User successfully logged out from all devices',
  })
  @ApiBearerAuth()
  logoutAll(@Body() data: LogoutAllDto) {
    return this.authService.logoutAll({
      accessToken: data.accessToken,
    });
  }

  @Public()
  @UseGuards(AuthGuard('google'))
  @Get('google')
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  async googleLogin() {
    // passport tự redirect → không cần code gì ở đây
  }

  @Public()
  @UseGuards(AuthGuard('google'))
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
    @Headers('x-device-id') deviceId: string,
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
      { ipAddress, userAgent, device: deviceId || userAgent },
    );

    const html = `
      <html>
        <body>
          <script>
            window.opener.postMessage(
              { 
                type: 'GOOGLE_LOGIN_SUCCESS', 
                tokens: ${JSON.stringify(tokens)} 
              }, 
              '*'
            );
            window.close();
          </script>
        </body>
      </html>
    `;
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  }

  @Public()
  @RateLimit({ limit: 3, window: 60 })
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
  @RateLimit({ limit: 3, window: 60 })
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset user password' })
  @ApiResponse({ status: 200, description: 'Password successfully reset' })
  resetPassword(@Body() data: ResetPasswordDto) {
    return this.authService.resetPassword(data);
  }

  @Public()
  @RateLimit({ limit: 5, window: 60 })
  @Post('verify-otp-from-authenticator')
  @ApiOperation({ summary: 'Verify OTP from authenticator' })
  @ApiResponse({ status: 200, description: 'OTP verified successfully' })
  verifyOtpFromAuthenticator(
    @Body() data: VerifyOtpFromAuthenticatorDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
    @Headers('x-device-id') deviceId: string,
  ) {
    return this.authService.verifyOtpFromAuthenticator(data, {
      ipAddress,
      userAgent,
      device: deviceId || userAgent,
    });
  }

  @Public()
  @RateLimit({ limit: 3, window: 60 })
  @Post('resend-code')
  @ApiOperation({ summary: 'Resend code' })
  @ApiResponse({ status: 200, description: 'Code resent successfully' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'user@example.com' },
        action: { type: 'string', example: 'verify_email' },
      },
    },
  })
  resendCode(@Body() data: ResendCodeDto) {
    return this.authService.resendCode(data);
  }

  @Public()
  @Post('secure-account')
  @ApiOperation({ summary: 'Secure account from unrecognized device email' })
  @ApiResponse({ status: 200, description: 'Account secured and sessions terminated' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsIn...' },
      },
    },
  })
  secureAccount(@Body('token') token: string) {
    return this.authService.secureAccount(token);
  }

  @Public()
  @Get('sso/login')
  @ApiOperation({ summary: 'Initiate Enterprise SSO Login' })
  async ssoLogin(
    @Query('domain') domain: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    if (!domain) {
      return res.status(400).json({ message: 'Domain is required' });
    }

    try {
      const ssoConfig = await this.workspaceService.findSsoConfigByDomain(domain);
      if (!ssoConfig) {
        return res.status(400).json({ message: `SSO is not enabled for domain ${domain}` });
      }

      const host = req.get('host');
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const callbackBase = `${protocol}://${host}/api/v1/auth/sso`;

      if (ssoConfig.providerType === 'SAML2') {
        const callbackUrl = `${callbackBase}/saml/callback`;
        const samlRequest = generateSamlRequest(
          ssoConfig.entryPoint,
          ssoConfig.issuer || 'slack-clone',
          callbackUrl,
        );
        const redirectUrl = `${ssoConfig.entryPoint}?SAMLRequest=${encodeURIComponent(samlRequest)}&RelayState=${encodeURIComponent(domain)}`;
        return res.redirect(redirectUrl);
      } else if (ssoConfig.providerType === 'OIDC') {
        let authUrl = ssoConfig.entryPoint;
        if (ssoConfig.discoveryUrl) {
          try {
            const discRes = await axios.get(ssoConfig.discoveryUrl);
            authUrl = discRes.data.authorization_endpoint || authUrl;
          } catch (err) {
            this.logger.error(`OIDC discovery failed for ${domain}: ${err.message}`);
          }
        }
        const callbackUrl = `${callbackBase}/oidc/callback`;
        const redirectUrl = `${authUrl}?response_type=code&client_id=${ssoConfig.clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=openid%20email%20profile&state=${encodeURIComponent(domain)}`;
        return res.redirect(redirectUrl);
      } else {
        return res.status(400).json({ message: 'Unsupported SSO provider type' });
      }
    } catch (error) {
      this.logger.error(`SSO Login initiation failed: ${error.message}`);
      return res.status(500).json({ message: 'Internal server error initiating SSO' });
    }
  }

  @Public()
  @Get('sso/oidc/callback')
  @ApiOperation({ summary: 'OIDC OAuth callback' })
  async oidcCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: any,
    @Res() res: any,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
    @Headers('x-device-id') deviceId: string,
  ) {
    try {
      const domain = state;
      const ssoConfig = await this.workspaceService.findSsoConfigByDomain(domain);
      if (!ssoConfig) {
        return this.sendSsoHtmlResponse(res, 'SSO configuration not found', null);
      }

      let tokenUrl = ssoConfig.entryPoint;
      if (ssoConfig.discoveryUrl) {
        try {
          const discRes = await axios.get(ssoConfig.discoveryUrl);
          tokenUrl = discRes.data.token_endpoint || tokenUrl;
        } catch (err) {
          this.logger.error(`OIDC discovery for token endpoint failed: ${err.message}`);
        }
      }

      const host = req.get('host');
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const callbackUrl = `${protocol}://${host}/api/v1/auth/sso/oidc/callback`;

      const tokenRes = await axios.post(
        tokenUrl,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: callbackUrl,
          client_id: ssoConfig.clientId,
          client_secret: ssoConfig.clientSecret,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      const idToken = tokenRes.data.id_token;
      if (!idToken) {
        return this.sendSsoHtmlResponse(res, 'No id_token returned from OIDC provider', null);
      }

      const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
      const email = payload.email;
      if (!email) {
        return this.sendSsoHtmlResponse(res, 'No email found in OIDC id_token', null);
      }

      const tokens: any = await this.authService.loginSso(
        { email },
        { ipAddress, userAgent, device: deviceId || userAgent },
      );

      const jwtPayload = JSON.parse(Buffer.from(tokens.accessToken.split('.')[1], 'base64').toString('utf8'));
      const userId = jwtPayload.sub;

      await this.workspaceService.addMemberSso({
        workspaceId: ssoConfig.workspaceId,
        userId,
      });

      return this.sendSsoHtmlResponse(res, null, tokens);
    } catch (error) {
      this.logger.error(`OIDC callback processing failed: ${error.message}`);
      return this.sendSsoHtmlResponse(res, `Authentication failed: ${error.message}`, null);
    }
  }

  @Public()
  @Post('sso/saml/callback')
  @ApiOperation({ summary: 'SAML 2.0 callback' })
  async samlCallback(
    @Body('SAMLResponse') samlResponse: string,
    @Body('RelayState') relayState: string,
    @Res() res: any,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
    @Headers('x-device-id') deviceId: string,
  ) {
    try {
      if (!samlResponse) {
        return this.sendSsoHtmlResponse(res, 'SAMLResponse is missing', null);
      }

      const domain = relayState;
      const ssoConfig = await this.workspaceService.findSsoConfigByDomain(domain);
      if (!ssoConfig) {
        return this.sendSsoHtmlResponse(res, 'SSO configuration not found', null);
      }

      const xml = Buffer.from(samlResponse, 'base64').toString('utf8');
      const email = parseSamlEmail(xml);
      if (!email) {
        return this.sendSsoHtmlResponse(res, 'Could not parse user email from SAML assertion', null);
      }

      const tokens: any = await this.authService.loginSso(
        { email },
        { ipAddress, userAgent, device: deviceId || userAgent },
      );

      const jwtPayload = JSON.parse(Buffer.from(tokens.accessToken.split('.')[1], 'base64').toString('utf8'));
      const userId = jwtPayload.sub;

      await this.workspaceService.addMemberSso({
        workspaceId: ssoConfig.workspaceId,
        userId,
      });

      return this.sendSsoHtmlResponse(res, null, tokens);
    } catch (error) {
      this.logger.error(`SAML callback processing failed: ${error.message}`);
      return this.sendSsoHtmlResponse(res, `Authentication failed: ${error.message}`, null);
    }
  }

  private sendSsoHtmlResponse(res: Response, error: string | null, tokens: any) {
    const dataObj = error
      ? { type: 'SSO_LOGIN_FAILURE', error }
      : { type: 'SSO_LOGIN_SUCCESS', tokens };

    const html = `
      <html>
        <body>
          <script>
            window.opener.postMessage(${JSON.stringify(dataObj)}, '*');
            window.close();
          </script>
        </body>
      </html>
    `;
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  }
}
