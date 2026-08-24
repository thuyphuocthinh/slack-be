import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import { isValidRelaySecret } from '../edge-relay/edge-relay-secret.util';
import { RpcException } from '@nestjs/microservices';

@Injectable()
export class EdgeAuthService {
  constructor(private readonly jwtService: JwtService) { }

  login(workspaceId: string, clientSecret: string) {
    if (!isValidRelaySecret(workspaceId, clientSecret)) {
      throw new RpcException(ORCHESTRATION_ERROR.EDGE_RELAY_UNAUTHORIZED);
    }

    return {
      accessToken: this.jwtService.sign({ sub: workspaceId }),
    };
  }
}
