import { EntityManager } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import * as crypto from 'crypto';
import { buildTTL } from '@slack/common';

import { OAuthTokenEntity } from '../../entity/oauth-token.entity';
import { OAuthClientEntity } from '../../entity/oauth-client.entity';
import { IOAuthTokenExchangeDto, IOAuthTokenExchangeResponse } from '../../types/oauth.interface';
import { IOAuthGrantStrategy } from './oauth-grant.strategy.interface';

export class RefreshTokenGrantStrategy implements IOAuthGrantStrategy {
  constructor(private readonly jwtService: JwtService) {}

  async exchange(
    manager: EntityManager,
    data: IOAuthTokenExchangeDto,
    client: OAuthClientEntity,
  ): Promise<IOAuthTokenExchangeResponse> {
    if (!data.refreshToken) {
      throw new RpcException({
        statusCode: 400,
        message: 'refresh_token parameter is required',
      });
    }

    const oldToken = await manager.findOne(OAuthTokenEntity, {
      where: { refreshToken: data.refreshToken },
      lock: { mode: 'pessimistic_write' },
    });

    if (!oldToken) {
      throw new RpcException({
        statusCode: 400,
        message: 'Invalid refresh token',
      });
    }

    if (oldToken.clientId !== data.clientId) {
      throw new RpcException({
        statusCode: 400,
        message: 'Refresh token client ID mismatch',
      });
    }

    let oldPayload: any;
    try {
      oldPayload = await this.jwtService.verifyAsync(oldToken.accessToken, {
        ignoreExpiration: true,
      });
    } catch (err) {
      throw new RpcException({
        statusCode: 400,
        message: 'Could not retrieve scopes from original access token',
      });
    }

    const tokenExpiresIn = buildTTL('HOUR', 1) / 1000;
    const expiresAt = new Date(Date.now() + buildTTL('HOUR', 1));

    const tokenPayload = {
      sub: oldToken.userId,
      client_id: oldToken.clientId,
      scopes: oldPayload.scopes || [],
      type: 'oauth_access',
    };

    const accessToken = await this.jwtService.signAsync(tokenPayload, {
      expiresIn: '1h',
    });

    const newRefreshToken = crypto.randomBytes(40).toString('hex');

    oldToken.accessToken = accessToken;
    oldToken.refreshToken = newRefreshToken;
    oldToken.expiresAt = expiresAt;

    await manager.save(oldToken);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      tokenType: 'Bearer',
      expiresIn: tokenExpiresIn,
    };
  }
}
