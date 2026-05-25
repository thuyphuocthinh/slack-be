import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageAttachmentEntity } from '../entity/message_attachment.entity';
import { GetAttachmentsQueryDto, AttachmentResponseDto } from '../dto';
import { IOffsetResponse } from '@slack/common';

@Injectable()
export class MessageAttachmentService {
  constructor(
    @InjectRepository(MessageAttachmentEntity)
    private readonly attachmentRepository: Repository<MessageAttachmentEntity>,
  ) {}

  async getAttachmentsByChannel(
    channelId: string,
    query: GetAttachmentsQueryDto,
  ): Promise<IOffsetResponse<AttachmentResponseDto[]>> {
    const { page = 1, limit = 20, mimeType } = query;
    const skip = (page - 1) * limit;

    const queryBuilder = this.attachmentRepository
      .createQueryBuilder('attachment')
      .innerJoin('attachment.message', 'message')
      .where('message.channelId = :channelId', { channelId })
      .orderBy('attachment.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    if (mimeType) {
      queryBuilder.andWhere('attachment.mimeType LIKE :mimeType', {
        mimeType: `%${mimeType}%`,
      });
    }

    const [items, total] = await queryBuilder.getManyAndCount();

    const responseData: AttachmentResponseDto[] = items.map((item) => ({
      ...item,
    }));

    return {
      data: responseData,
      paging: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    } as unknown as IOffsetResponse<AttachmentResponseDto[]>;
  }
}
