import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { INTEGRATIONS_MESSAGE_PATTERNS } from '@slack/constants';
import { AuthService } from './auth.service';
import {
  GetMyConnectionsRequestDto,
  GetMyConnectionsResponseDto,
  GenerateAuthUrlRequestDto,
  GenerateAuthUrlResponseDto,
  HandleCallbackRequestDto,
  HandleCallbackResponseDto,
  RevokeConnectionRequestDto,
  RevokeConnectionResponseDto,
  SaveApiKeyRequestDto,
  SaveApiKeyResponseDto,
} from './dto/auth.dto';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @MessagePattern(INTEGRATIONS_MESSAGE_PATTERNS.GET_MY_CONNECTIONS)
  async getMyConnections(@Payload() payload: GetMyConnectionsRequestDto): Promise<GetMyConnectionsResponseDto> {
    return this.authService.getMyConnections(payload.userId);
  }

  @MessagePattern(INTEGRATIONS_MESSAGE_PATTERNS.AUTH_GENERATE_URL)
  async generateAuthUrl(@Payload() payload: GenerateAuthUrlRequestDto): Promise<GenerateAuthUrlResponseDto> {
    return this.authService.generateAuthUrl(payload);
  }

  @MessagePattern(INTEGRATIONS_MESSAGE_PATTERNS.AUTH_HANDLE_CALLBACK)
  async handleCallback(@Payload() payload: HandleCallbackRequestDto): Promise<HandleCallbackResponseDto> {
    return this.authService.handleCallback(payload);
  }

  @MessagePattern(INTEGRATIONS_MESSAGE_PATTERNS.REVOKE_CONNECTION)
  async revokeConnection(@Payload() payload: RevokeConnectionRequestDto): Promise<RevokeConnectionResponseDto> {
    return this.authService.revokeConnection(payload);
  }

  @MessagePattern(INTEGRATIONS_MESSAGE_PATTERNS.SAVE_API_KEY)
  async saveApiKey(@Payload() payload: SaveApiKeyRequestDto): Promise<SaveApiKeyResponseDto> {
    return this.authService.saveApiKey(payload);
  }
}
