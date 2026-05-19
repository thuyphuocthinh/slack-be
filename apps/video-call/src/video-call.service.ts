import { Injectable, Logger, InternalServerErrorException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { AccessToken, WebhookReceiver } from 'livekit-server-sdk';
import { firstValueFrom } from 'rxjs';
import {
  ESocketEvent,
  NAME_SERVICE_TCP,
  CHANNEL_MESSAGE_PATTERN,
} from '@slack/constants';
import { QueueService, EQueueName, EJobName } from '@slack/queue';
import { HuddleEntity } from './entity/huddle.entity';
import { HuddleParticipantEntity } from './entity/huddle-participant.entity';
import {
  JoinHuddleRequestDto,
  LeaveHuddleRequestDto,
  JoinHuddleResponseDto,
  LeaveHuddleResponseDto,
  HandleWebhookRequestDto,
  WebhookResponseDto,
  ChannelMemberInfo,
} from './dto/video-call.dto';

@Injectable()
export class VideoCallService {
  private readonly logger = new Logger(VideoCallService.name);

  constructor(
    @InjectRepository(HuddleEntity)
    private readonly huddleRepository: Repository<HuddleEntity>,

    @InjectRepository(HuddleParticipantEntity)
    private readonly huddleParticipantRepository: Repository<HuddleParticipantEntity>,

    private readonly configService: ConfigService,

    private readonly queueService: QueueService,

    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
  ) {}

  async joinHuddle(dto: JoinHuddleRequestDto): Promise<JoinHuddleResponseDto> {
    try {
      const { channelId, userId, identity, name } = dto;

      // 1. Tìm phiên Huddle đang hoạt động cho Channel này
      let huddle = await this.huddleRepository.findOne({
        where: { channelId, isActive: true },
      });

      // 2. Nếu chưa có huddle nào đang active, tạo mới phiên huddle
      if (!huddle) {
        huddle = this.huddleRepository.create({
          channelId,
          isActive: true,
        });
        huddle = await this.huddleRepository.save(huddle);
        this.logger.log(`Created new huddle session: ${huddle.id} for channel: ${channelId}`);
      } else {
        this.logger.log(`Found active huddle session: ${huddle.id} for channel: ${channelId}`);
      }

      // 3. Đăng ký/cập nhật trạng thái tham gia huddle của participant
      let participant = await this.huddleParticipantRepository.findOne({
        where: { huddleId: huddle.id, userId },
      });

      if (!participant) {
        participant = this.huddleParticipantRepository.create({
          huddleId: huddle.id,
          userId,
          leftAt: null,
          isMuted: false,
          isScreenSharing: false,
        });
      } else {
        // Nếu trước đó đã rời phòng, giờ quay lại
        participant.leftAt = null;
      }
      await this.huddleParticipantRepository.save(participant);

      // 4. Tạo LiveKit AccessToken
      const apiKey = this.configService.get<string>('LIVEKIT_API_KEY');
      const apiSecret = this.configService.get<string>('LIVEKIT_API_SECRET');
      const livekitUrl = this.configService.get<string>('LIVEKIT_URL') || 'ws://localhost:7880';

      if (!apiKey || !apiSecret) {
        throw new Error('LIVEKIT_API_KEY or LIVEKIT_API_SECRET is not configured');
      }

      // Tạo tên phòng (roomName) chính là huddle ID
      const roomName = huddle.id;

      const at = new AccessToken(apiKey, apiSecret, {
        identity: identity,
        name: name,
      });

      // Cấp quyền tham gia phòng, truyền và nhận media stream
      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
      });

      const token = await at.toJwt();

      return {
        token,
        huddleId: huddle.id,
        livekitUrl,
        roomName,
      };
    } catch (error) {
      this.logger.error(`Error in joinHuddle: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Could not join Huddle: ${error.message}`);
    }
  }

  async leaveHuddle(dto: LeaveHuddleRequestDto): Promise<LeaveHuddleResponseDto> {
    try {
      const { huddleId, userId } = dto;

      // 1. Cập nhật thời gian rời phòng của participant
      const participant = await this.huddleParticipantRepository.findOne({
        where: { huddleId, userId, leftAt: IsNull() },
      });

      if (participant) {
        participant.leftAt = new Date();
        await this.huddleParticipantRepository.save(participant);
        this.logger.log(`Participant ${userId} left huddle ${huddleId}`);
      }

      // 2. Đếm số lượng participant còn lại đang hoạt động trong huddle này
      const activeCount = await this.huddleParticipantRepository.count({
        where: { huddleId, leftAt: IsNull() },
      });

      // 3. Nếu không còn ai, đánh dấu huddle kết thúc
      if (activeCount === 0) {
        const huddle = await this.huddleRepository.findOne({
          where: { id: huddleId, isActive: true },
        });

        if (huddle) {
          huddle.isActive = false;
          huddle.endedAt = new Date();
          await this.huddleRepository.save(huddle);
          this.logger.log(`Huddle ${huddleId} has ended because all participants left`);
        }
      }

      return {
        success: true,
        huddleId,
      };
    } catch (error) {
      this.logger.error(`Error in leaveHuddle: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Could not leave Huddle: ${error.message}`);
    }
  }

  async handleWebhook(dto: HandleWebhookRequestDto): Promise<WebhookResponseDto> {
    try {
      const { authHeader, body } = dto;

      const apiKey = this.configService.get<string>('LIVEKIT_API_KEY');
      const apiSecret = this.configService.get<string>('LIVEKIT_API_SECRET');

      if (!apiKey || !apiSecret) {
        throw new Error('LIVEKIT_API_KEY or LIVEKIT_API_SECRET is not configured');
      }

      const receiver = new WebhookReceiver(apiKey, apiSecret);
      
      // LiveKit webhook receiver yêu cầu raw string payload để check signature
      const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
      const skipAuth = this.configService.get<string>('LIVEKIT_SKIP_WEBHOOK_AUTH') === 'true' || this.configService.get<string>('NODE_ENV') === 'development';
      const event = await receiver.receive(rawBody, authHeader, skipAuth);
      
      this.logger.log(`Received verified LiveKit Webhook event: ${event.event} (skipAuth: ${skipAuth})`);
      
      const roomName = event.room?.name; // roomName chính là huddleId (UUID)
      if (!roomName) {
        this.logger.warn(`Webhook event ${event.event} has no room name`);
        return { success: false, message: 'No room name provided' };
      }

      // Tìm huddle tương ứng trong DB
      const huddle = await this.huddleRepository.findOne({
        where: { id: roomName },
      });

      if (!huddle) {
        this.logger.warn(`No huddle found in database with ID: ${roomName}`);
        return { success: false, message: 'Huddle not found' };
      }

      const channelId = huddle.channelId;

      // Lấy danh sách thành viên trong channel qua TCP Client của ChannelService
      // Điều này đảm bảo chỉ emit tin nhắn socket tới các thành viên thuộc channel này.
      let userIds: string[] = [];
      try {
        const members = await firstValueFrom(
          this.channelClient.send<ChannelMemberInfo[]>(CHANNEL_MESSAGE_PATTERN.GET_MEMBERS, { channelId }),
        );
        userIds = members.map((m) => m.memberId);
      } catch (err) {
        this.logger.error(`Failed to fetch members for channel ${channelId}: ${err.message}`);
      }

      switch (event.event) {
        case 'room_started':
          // Cập nhật trạng thái Huddle
          huddle.isActive = true;
          await this.huddleRepository.save(huddle);
          this.logger.log(`Huddle ${huddle.id} started. Broadcasting to channel members: [${userIds.join(', ')}]`);
          
          if (userIds.length > 0) {
            await this.queueService.addJob(
              EQueueName.SOCKET_QUEUE,
              EJobName.EMIT_TO_USERS,
              {
                event: ESocketEvent.HUDDLE_STARTED,
                userIds,
                data: {
                  huddleId: huddle.id,
                  channelId,
                },
              },
            );
          }
          break;

        case 'participant_joined':
          const participantId = event.participant?.identity;
          if (participantId) {
            let participant = await this.huddleParticipantRepository.findOne({
              where: { huddleId: huddle.id, userId: participantId },
            });

            if (!participant) {
              participant = this.huddleParticipantRepository.create({
                huddleId: huddle.id,
                userId: participantId,
                leftAt: null,
              });
            } else {
              participant.leftAt = null;
            }
            await this.huddleParticipantRepository.save(participant);
            this.logger.log(`Participant ${participantId} joined huddle ${huddle.id}`);

            if (userIds.length > 0) {
              await this.queueService.addJob(
                EQueueName.SOCKET_QUEUE,
                EJobName.EMIT_TO_USERS,
                {
                  event: ESocketEvent.HUDDLE_PARTICIPANT_JOINED,
                  userIds,
                  data: {
                    huddleId: huddle.id,
                    channelId,
                    userId: participantId,
                  },
                },
              );
            }
          }
          break;

        case 'participant_left':
          const leftParticipantId = event.participant?.identity;
          if (leftParticipantId) {
            const participant = await this.huddleParticipantRepository.findOne({
              where: { huddleId: huddle.id, userId: leftParticipantId, leftAt: IsNull() },
            });

            if (participant) {
              participant.leftAt = new Date();
              await this.huddleParticipantRepository.save(participant);
              this.logger.log(`Participant ${leftParticipantId} left huddle ${huddle.id} (detected via Webhook)`);
            }

            if (userIds.length > 0) {
              await this.queueService.addJob(
                EQueueName.SOCKET_QUEUE,
                EJobName.EMIT_TO_USERS,
                {
                  event: ESocketEvent.HUDDLE_PARTICIPANT_LEFT,
                  userIds,
                  data: {
                    huddleId: huddle.id,
                    channelId,
                    userId: leftParticipantId,
                  },
                },
              );
            }
          }
          break;

        case 'room_finished':
          huddle.isActive = false;
          huddle.endedAt = new Date();
          await this.huddleRepository.save(huddle);
          this.logger.log(`Huddle ${huddle.id} ended. Broadcasting to channel members: [${userIds.join(', ')}]`);

          // Dọn dẹp cập nhật leftAt cho các participant chưa kịp ghi nhận rời phòng
          await this.huddleParticipantRepository.update(
            { huddleId: huddle.id, leftAt: IsNull() },
            { leftAt: new Date() }
          );

          if (userIds.length > 0) {
            await this.queueService.addJob(
              EQueueName.SOCKET_QUEUE,
              EJobName.EMIT_TO_USERS,
              {
                event: ESocketEvent.HUDDLE_ENDED,
                userIds,
                data: {
                  huddleId: huddle.id,
                  channelId,
                },
              },
            );
          }
          break;

        default:
          this.logger.debug(`Unhandled LiveKit event: ${event.event}`);
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`Error processing Webhook: ${error.message}`, error.stack);
      return { success: false, error: error.message };
    }
  }
}
