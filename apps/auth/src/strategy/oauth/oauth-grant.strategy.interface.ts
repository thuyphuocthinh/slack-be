import { EntityManager } from 'typeorm';
import { IOAuthTokenExchangeDto, IOAuthTokenExchangeResponse } from '../../types/oauth.interface';
import { OAuthClientEntity } from '../../entity/oauth-client.entity';

export interface IOAuthGrantStrategy {
  exchange(
    manager: EntityManager,
    data: IOAuthTokenExchangeDto,
    client: OAuthClientEntity,
  ): Promise<IOAuthTokenExchangeResponse>;
}
