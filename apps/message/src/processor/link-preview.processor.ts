import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageEntity } from '../entity/message.entity';
import { LinkScraperService } from '../service/link-scraper.service';
import { MessageService } from '../service/message.service';
import { CachedService, CACHE } from '@slack/cached';
import {
  BaseProcessor,
  EJobName,
  EQueueName,
  QueueService,
  IGenerateLinkPreviewJobData,
} from '@slack/queue';
import { ILinkPreviewMetadata } from '../types/link-preview.interface';
import { ESocketEvent } from '@slack/constants';
import { Logger } from '@nestjs/common';

@Processor(EQueueName.LINK_PREVIEW_QUEUE, { concurrency: 5 })
export class LinkPreviewProcessor extends BaseProcessor<
  IGenerateLinkPreviewJobData,
  void,
  EJobName
> {
  constructor(
    private readonly scraperService: LinkScraperService,
    private readonly cachedService: CachedService,
    private readonly queueService: QueueService,
    private readonly messageService: MessageService,
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
  ) {
    super();
  }

  async process(
    job: Job<IGenerateLinkPreviewJobData, void, EJobName>,
  ): Promise<void> {
    switch (job.name) {
      case EJobName.GENERATE_LINK_PREVIEW: {
        this.logger.debug(`Processing link preview for message: ${job.data.messageId}`);
        try {
          await this.handleGeneratePreview(job.data);
        } catch (error) {
          this.logger.error(
            `Failed to generate link preview for message ${job.data.messageId}: ${(error as Error).message}`,
            (error as Error).stack,
          );
          throw error;
        }
        break;
      }
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Job name ${job.name} is not supported`);
    }
  }

  private async handleGeneratePreview(data: IGenerateLinkPreviewJobData): Promise<void> {
    const { messageId, urls } = data;
    const finalPreviews: ILinkPreviewMetadata[] = [];
    const uniqueUrls = [...new Set(urls)].slice(0, 3);

    this.logger.log(`Generating link preview for message: ${messageId}, URLs: ${uniqueUrls.join(', ')}`);

    for (const url of uniqueUrls) {
      const b64Url = Buffer.from(url).toString('base64url');
      const cacheKey = CACHE.MESSAGE.KEYS.LINK_PREVIEW(b64Url);

      const cachedData = await this.cachedService.get<ILinkPreviewMetadata | 'FAILED'>(cacheKey);

      if (cachedData === 'FAILED') {
        this.logger.log(`Cache HIT (Negative/FAILED) for URL: ${url}`);
        continue;
      }

      if (cachedData) {
        this.logger.log(`Cache HIT (Positive) for URL: ${url}`);
        finalPreviews.push(cachedData);
        continue;
      }

      this.logger.log(`Cache MISS for URL: ${url}. Fetching...`);
      const meta = await this.scraperService.scrape(url);

      if (meta) {
        this.logger.log(`Successfully scraped URL: ${url}`);
        finalPreviews.push(meta);
        await this.cachedService.set(cacheKey, meta, 86400); // 24h
      } else {
        this.logger.log(`Failed to scrape URL: ${url}. Writing negative cache.`);
        await this.cachedService.set(cacheKey, 'FAILED', 3600); // 1h
      }
    }

    if (finalPreviews.length > 0) {
      this.logger.log(`Updating message ${messageId} with ${finalPreviews.length} link previews.`);
      await this.messageRepository.update(messageId, {
        linkPreviews: finalPreviews,
      });

      const updatedMessage = await this.messageRepository.findOne({
        where: { id: messageId },
      });

      if (updatedMessage) {
        const [hydratedMessage] = await this.messageService.hydrateMessages([updatedMessage]);

        if (hydratedMessage) {
          this.logger.log(`Emitting updated message socket event for message ${messageId} to channel ${updatedMessage.channelId}`);
          await this.queueService.addJob(
            EQueueName.SOCKET_QUEUE,
            EJobName.EMIT_EVENT,
            {
              event: ESocketEvent.MESSAGE_UPDATED,
              room: updatedMessage.channelId,
              data: hydratedMessage,
            },
          );
        }
      }
    } else {
      this.logger.log(`No link previews generated for message ${messageId}`);
    }
  }
}
