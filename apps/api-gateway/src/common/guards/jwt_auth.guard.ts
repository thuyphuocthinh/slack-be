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

const IGNORE_ROUTES = ['/docs', '/favicon.ico'];

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
    // startsWith (không phải includes) — tránh bắt nhầm path chứa "docs" như
    // /ai-providers/google_docs/connect làm request bỏ qua auth (req.user
    // không được set, controller crash khi đọc user.sub).
    if (IGNORE_ROUTES.some((route) => request.url.startsWith(route))) {
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

    try {
      const payload = this.jwtService.verify(token);
      this.logger.log(`JWT Payload: ${JSON.stringify(payload)}`);

      // check blacklist + version — 2 lời gọi Redis độc lập (không phụ thuộc
      // kết quả của nhau), chạy song song thay vì nối tiếp để giảm latency
      // cho MỌI request có auth (áp dụng toàn app qua APP_GUARD).
      const [isBlacklisted, currentVersion] = await Promise.all([
        this.authCache.isBlacklisted(token),
        this.authCache.getUserTokenVersion(payload.sub),
      ]);

      if (isBlacklisted) {
        throw new UnauthorizedException(AUTH_ERROR.UNAUTHORIZED);
      }

      if (payload.tokenVersion !== currentVersion) {
        throw new UnauthorizedException(AUTH_ERROR.UNAUTHORIZED);
      }

      req.user = payload;
    } catch (error) {
      this.logger.error(`JWT Verification failed: ${error.message}`);
      throw new UnauthorizedException(AUTH_ERROR.UNAUTHORIZED);
    }

    return true;
  }
}
