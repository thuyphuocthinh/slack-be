import {
  OnModuleInit,
  OnModuleDestroy,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { TiptapTransformer } from '@hocuspocus/transformer';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CanvasEntity } from '../entity/canvas.entity';
import { JwtService } from '@nestjs/jwt';
import { AuthCacheService } from '@slack/cached';

import { CanvasService } from '../canvas.service';

@Injectable()
export class HocuspocusGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HocuspocusGateway.name);
  private server: Server;

  constructor(
    @InjectRepository(CanvasEntity)
    private readonly canvasRepo: Repository<CanvasEntity>,
    private readonly jwtService: JwtService,
    private readonly authCache: AuthCacheService,
    private readonly canvasService: CanvasService,
  ) { }

  async onModuleInit() {
    const jwtService = this.jwtService;
    const authCache = this.authCache;
    const canvasRepo = this.canvasRepo;
    const canvasService = this.canvasService;
    const logger = this.logger;

    this.server = new Server({
      port: parseInt(process.env.HOCUSPOCUS_PORT || '8080', 10),
      debounce: 2500, // Debounce 2.5s for onStoreDocument
      maxDebounce: 10000, // Force save every 10s max
      async onAuthenticate(data) {
        const { token, documentName } = data;
        if (!token) throw new Error('Unauthorized');
        try {
          const payload = await jwtService.verifyAsync(token, {
            secret: process.env.JWT_ACCESS_SECRET || 'secret',
          });
          const isBlacklisted = await authCache.isBlacklisted(token);
          if (isBlacklisted) throw new Error('Unauthorized');

          const currentVersion = await authCache.getUserTokenVersion(
            payload.sub,
          );
          if (payload.tokenVersion !== currentVersion)
            throw new Error('Unauthorized');

          // Verify documentName (Canvas ID) belongs to the channel/workspace the user has access to
          const canvas = await canvasRepo.findOne({
            where: { id: documentName },
          });

          if (!canvas) {
            throw new Error('Canvas not found');
          }

          // Check if user has permission to access the channel
          await canvasService.checkChannelAccess(canvas.channelId, payload.sub);
          data.context.canvas = canvas;

          return { user: payload };
        } catch (error) {
          logger.error(`WebSocket auth failed: ${error.message}`);
          throw error;
        }
      },
      extensions: [
        new Database({
          fetch: async ({ documentName, context }) => {
            const canvas = context.canvas
              ?? await canvasRepo.findOne({ where: { id: documentName } });
            return canvas?.contentState ?? null;
          },
          store: async ({ documentName, state, document }) => {
            const contentJson = TiptapTransformer.fromYdoc(document, 'default');
            await canvasRepo.update(documentName, {
              contentState: Buffer.from(state),
              contentJson,
            });
          },
        }),
      ],
    });

    this.server.listen();
    this.logger.log('Hocuspocus Server listening on port 8080');
  }

  async onModuleDestroy() {
    if (this.server) {
      await this.server.destroy();
    }
  }
}
