import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ORCHESTRATION_MESSAGE_PATTERNS } from '@slack/constants';
import { EdgeAuthService } from './edge-auth.service';
import { EdgeLoginDto, EdgeLoginResponseDto } from './dto/login.dto';

@Controller('edge-relay/auth')
export class EdgeAuthController {
  constructor(private readonly edgeAuthService: EdgeAuthService) { }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.EDGE_RELAY_LOGIN)
  loginViaTcp(@Payload() dto: EdgeLoginDto): EdgeLoginResponseDto {
    return this.edgeAuthService.login(dto.workspaceId, dto.clientSecret);
  }
}
