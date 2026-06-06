import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CanvasEntity } from './entity/canvas.entity';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  NAME_SERVICE_TCP,
  CHANNEL_MESSAGE_PATTERN,
  CanvasError,
} from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { GetCanvasByChannelDto, GetCanvasByIdDto } from './dto/get-canvas.dto';
import { CreateCanvasDto } from './dto/create-canvas.dto';
import { CanvasResponseDto } from './dto/canvas-response.dto';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class CanvasService {
  private readonly logger = new Logger(CanvasService.name);

  constructor(
    @InjectRepository(CanvasEntity)
    private readonly canvasRepo: Repository<CanvasEntity>,
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
  ) {}

  async checkChannelAccess(channelId: string, memberId: string) {
    try {
      const access = await firstValueFrom(
        this.channelClient.send(CHANNEL_MESSAGE_PATTERN.GET_CHANNEL, {
          channelId,
          memberId,
        }),
      );
      if (!access) {
        throw new RpcException(CanvasError.CANVAS_NO_PERMISSION);
      }
      return access;
    } catch (error) {
      this.logger.error(`Error checking channel access: ${error.message}`);
      throw new RpcException(CanvasError.CANVAS_NO_PERMISSION);
    }
  }

  private mapToResponse(canvas: CanvasEntity): CanvasResponseDto {
    return plainToInstance(CanvasResponseDto, canvas, {
      excludeExtraneousValues: true,
    });
  }

  async getCanvasByChannel(
    dto: GetCanvasByChannelDto,
  ): Promise<CanvasResponseDto | null> {
    await this.checkChannelAccess(dto.channelId, dto.userId);

    const canvas = await this.canvasRepo.findOne({
      where: { channelId: dto.channelId },
    });

    return canvas ? this.mapToResponse(canvas) : null;
  }

  async getCanvasById(dto: GetCanvasByIdDto): Promise<CanvasResponseDto> {
    const canvas = await this.canvasRepo.findOne({ where: { id: dto.id } });
    if (!canvas) {
      throw new RpcException(CanvasError.CANVAS_NOT_FOUND);
    }

    if (canvas.channelId) {
      await this.checkChannelAccess(canvas.channelId, dto.userId);
    }

    return this.mapToResponse(canvas);
  }

  async createCanvas(dto: CreateCanvasDto): Promise<CanvasResponseDto> {
    // 1. Luôn check quyền trước khi thao tác DB
    await this.checkChannelAccess(dto.channelId, dto.userId);

    // 2. Best Practice: Dùng Atomic Operation (SQL Insert ... ON CONFLICT DO NOTHING)
    // kết hợp với Unique Constraint của channelId trên DB để chống Race Condition (Double-action)
    // Thay vì dùng findOne -> kiểm tra -> save (dễ bị race condition khi 2 người cùng bấm tạo)
    await this.canvasRepo
      .createQueryBuilder()
      .insert()
      .into(CanvasEntity)
      .values({
        channelId: dto.channelId,
        updatedBy: dto.userId,
      })
      .orIgnore()
      .execute();

    // 3. Query lại bản ghi (vừa được tạo mới hoặc đã tồn tại từ trước)
    const canvas = await this.canvasRepo.findOne({
      where: { channelId: dto.channelId },
    });

    if (!canvas) {
      throw new RpcException(CanvasError.CANVAS_CREATION_FAILED);
    }

    this.logger.log(`Canvas requested/created with id: ${canvas.id}`);
    return this.mapToResponse(canvas);
  }
}
