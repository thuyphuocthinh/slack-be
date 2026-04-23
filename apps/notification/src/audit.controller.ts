import { Controller } from '@nestjs/common';
import { AuditService } from './services/impl/audit.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuditMsgPattern } from '@slack/constants';
import { CreateAuditLogDto, FetchAuditLogsDto } from './dto';
import { AuditLog } from './entity/audit.entity';
import { IOffsetResponse } from '@slack/common';

@Controller()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @MessagePattern(AuditMsgPattern.CREATE_AUDIT_LOG)
  async createAuditLog(@Payload() dto: CreateAuditLogDto): Promise<AuditLog> {
    return this.auditService.createAuditLog(dto);
  }

  @MessagePattern(AuditMsgPattern.FETCH_AUDIT_LOGS)
  async fetchAuditLogs(
    @Payload() dto: FetchAuditLogsDto,
  ): Promise<IOffsetResponse<AuditLog[]>> {
    return this.auditService.fetchAuditLogs(dto);
  }
}
