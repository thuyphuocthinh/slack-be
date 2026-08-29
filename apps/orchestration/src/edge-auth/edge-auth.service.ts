import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import { isValidRelaySecret } from '../edge-relay/edge-relay-secret.util';
import { RpcException } from '@nestjs/microservices';

@Injectable()
export class EdgeAuthService {
  private readonly logger = new Logger(EdgeAuthService.name);

  constructor(private readonly jwtService: JwtService) {}

  login(workspaceId: string, clientSecret: string) {
    if (!isValidRelaySecret(workspaceId, clientSecret)) {
      this.logger.warn(
        `Edge relay login rejected for workspaceId=${workspaceId}`,
      );
      throw new RpcException(ORCHESTRATION_ERROR.EDGE_RELAY_UNAUTHORIZED);
    }

    this.logger.log(
      `Edge relay login succeeded for workspaceId=${workspaceId}`,
    );
    return {
      accessToken: this.jwtService.sign({ sub: workspaceId }),
    };
  }
}
