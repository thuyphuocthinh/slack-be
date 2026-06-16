import { EntityManager } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import * as crypto from 'crypto';
import { buildTTL } from '@slack/common';
import { OAUTH_ERROR } from '@slack/constants';

import { OAuthAuthCodeEntity } from '../../entity/oauth-auth-code.entity';
import { OAuthTokenEntity } from '../../entity/oauth-token.entity';
import { OAuthClientEntity } from '../../entity/oauth-client.entity';
import { IOAuthTokenExchangeDto, IOAuthTokenExchangeResponse } from '../../types/oauth.interface';
import { IOAuthGrantStrategy } from './oauth-grant.strategy.interface';

export class AuthorizationCodeGrantStrategy implements IOAuthGrantStrategy {
  constructor(private readonly jwtService: JwtService) {}

  async exchange(
    manager: EntityManager,
    data: IOAuthTokenExchangeDto,
    client: OAuthClientEntity,
  ): Promise<IOAuthTokenExchangeResponse> {
    if (!data.code || !data.redirectUri) {
      throw new RpcException({
        statusCode: 400,
        message: 'code and redirectUri parameters are required',
      });
    }

    const authCode = await manager.findOne(OAuthAuthCodeEntity, {
      where: { code: data.code },
      lock: { mode: 'pessimistic_write' },
    });

    if (!authCode || authCode.expiresAt.getTime() < Date.now()) {
      throw new RpcException(OAUTH_ERROR.AUTH_CODE_EXPIRED);
    }

    if (authCode.clientId !== data.clientId || authCode.redirectUri !== data.redirectUri) {
      throw new RpcException(OAUTH_ERROR.REDIRECT_URI_MISMATCH);
    }

    await manager.remove(authCode);

    const tokenExpiresIn = buildTTL('HOUR', 1) / 1000;
    const expiresAt = new Date(Date.now() + buildTTL('HOUR', 1));

    const tokenPayload = {
      sub: authCode.userId,
      client_id: authCode.clientId,
      scopes: authCode.scopes,
      type: 'oauth_access',
    };

    const accessToken = await this.jwtService.signAsync(tokenPayload, {
      expiresIn: '1h',
    });

    const refreshToken = crypto.randomBytes(40).toString('hex');

    const oauthToken = manager.create(OAuthTokenEntity, {
      accessToken,
      refreshToken,
      clientId: authCode.clientId,
      userId: authCode.userId,
      expiresAt,
    });

    await manager.save(oauthToken);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: tokenExpiresIn,
    };
  }
}
