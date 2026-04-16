import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthCacheService } from '@slack/cached';
import { IS_PUBLIC_KEY } from '@slack/common';
import { AUTH_ERROR } from '@slack/constants';

const IGNORE_ROUTES = ['docs', 'favicon.ico'];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private jwtService: JwtService,
    private authCache: AuthCacheService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (IGNORE_ROUTES.some((route) => request.url.includes(route))) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest();

    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return false;

    const payload = this.jwtService.verify(token);
    this.logger.log(`JWT Payload: ${JSON.stringify(payload)}`);

    // check blacklist
    if (await this.authCache.isBlacklisted(token)) {
      throw new UnauthorizedException(AUTH_ERROR.UNAUTHORIZED);
    }

    // check version
    const currentVersion = await this.authCache.getUserTokenVersion(
      payload.sub,
    );
    this.logger.log(`Current Version: ${currentVersion}`);
    this.logger.log(`Payload Version: ${payload.tokenVersion}`);

    if (payload.tokenVersion !== currentVersion) {
      throw new UnauthorizedException(AUTH_ERROR.UNAUTHORIZED);
    }

    req.user = payload;

    return true;
  }
}
