import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { AuthCacheService } from "@slack/cached";
import { IS_PUBLIC_KEY } from "@slack/common";
import { AUTH_ERROR } from "@slack/constants";

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private jwtService: JwtService,
        private authCache: AuthCacheService,
        private readonly reflector: Reflector,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
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

        // check blacklist
        if (await this.authCache.isBlacklisted(token)) {
            throw new UnauthorizedException(AUTH_ERROR.UNAUTHORIZED);
        }

        // check version
        const currentVersion = await this.authCache.getUserTokenVersion(payload.sub);

        if (payload.version !== currentVersion) {
            throw new UnauthorizedException(AUTH_ERROR.UNAUTHORIZED);
        }

        req.user = payload;

        return true;
    }
}