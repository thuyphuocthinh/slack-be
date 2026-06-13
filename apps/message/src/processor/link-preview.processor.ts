import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageEntity } from '../entity/message.entity';
import { LinkPreviewEntity } from '../entity/link-preview.entity';
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
import * as crypto from 'crypto';

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
    @InjectRepository(LinkPreviewEntity)
    private readonly linkPreviewRepository: Repository<LinkPreviewEntity>,
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
      const urlHash = crypto.createHash('sha256').update(url).digest('hex');
      const cacheKey = CACHE.MESSAGE.KEYS.LINK_PREVIEW(urlHash);

      // 1. Check L1 Cache (Redis)
      const cachedData = await this.cachedService.get<ILinkPreviewMetadata | 'FAILED'>(cacheKey);

      if (cachedData === 'FAILED') {
        this.logger.log(`Cache HIT (L1 Negative/FAILED) for URL: ${url}`);
        continue;
      }

      if (cachedData) {
        this.logger.log(`Cache HIT (L1 Positive) for URL: ${url}`);
        finalPreviews.push(cachedData);
        continue;
      }

      // 2. Check L2 Cache (Postgres Database)
      const dbPreview = await this.linkPreviewRepository.findOne({
        where: { urlHash },
      });

      if (dbPreview) {
        this.logger.log(`Database HIT (L2) for URL: ${url}`);
        const meta: ILinkPreviewMetadata = {
          url: dbPreview.url,
          title: dbPreview.title || undefined,
          description: dbPreview.description || undefined,
          imageUrl: dbPreview.imageUrl || undefined,
          siteName: dbPreview.siteName || undefined,
          favIcon: dbPreview.favIcon || undefined,
        };
        finalPreviews.push(meta);
        // Warm up L1 Cache
        await this.cachedService.set(cacheKey, meta, 86400); // 24h
        continue;
      }

      // 3. Cache Miss - Scrape from target website
      this.logger.log(`Cache MISS (L1 & L2) for URL: ${url}. Fetching...`);
      const meta = await this.scraperService.scrape(url);

      if (meta) {
        this.logger.log(`Successfully scraped URL: ${url}`);
        finalPreviews.push(meta);

        // Save to L2 Cache (Database)
        try {
          await this.linkPreviewRepository.save(
            this.linkPreviewRepository.create({
              urlHash,
              url: meta.url || url,
              title: meta.title,
              description: meta.description,
              imageUrl: meta.imageUrl,
              siteName: meta.siteName,
              favIcon: meta.favIcon,
            }),
          );
        } catch (dbErr) {
          this.logger.warn(`Failed to save preview to L2 database: ${(dbErr as Error).message}`);
        }

        // Save to L1 Cache (Redis)
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
