import {
  OnModuleInit,
  OnModuleDestroy,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  Server,
  onAuthenticatePayload,
  fetchPayload,
  storePayload,
} from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { Redis } from '@hocuspocus/extension-redis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PagesEntity } from '../entity/pages.entity';
import { PageDocumentsEntity } from '../entity/page_documents.entity';
import { JwtService } from '@nestjs/jwt';
import { AuthCacheService } from '@slack/cached';
import { PermissionsService } from '../services/permissions.service';
import { PermissionType } from '../types/permission.types';
import { YjsBlocksSyncService } from '../services/yjs-blocks-sync.service';

@Injectable()
export class HocuspocusGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HocuspocusGateway.name);
  private server: Server;

  constructor(
    @InjectRepository(PagesEntity)
    private readonly pagesRepo: Repository<PagesEntity>,
    @InjectRepository(PageDocumentsEntity)
    private readonly pageDocumentsRepo: Repository<PageDocumentsEntity>,
    private readonly jwtService: JwtService,
    private readonly authCache: AuthCacheService,
    private readonly permissionsService: PermissionsService,
    private readonly yjsBlocksSyncService: YjsBlocksSyncService,
  ) {}

  // ===== Lifecycle =====

  async onModuleInit() {
    this.server = new Server({
      port: parseInt(process.env.NOTE_HOCUSPOCUS_PORT || '8081', 10),
      debounce: 2500,
      maxDebounce: 10000,
      onAuthenticate: this.handleAuthenticate.bind(this),
      extensions: [this.getRedisExtension(), this.getDatabaseExtension()],
    });

    this.server.listen();
    this.logger.log(
      `Note Hocuspocus Server listening on port ${process.env.NOTE_HOCUSPOCUS_PORT || '8081'}`,
    );
  }

  async onModuleDestroy() {
    if (this.server) {
      await this.server.destroy();
    }
  }

  // ===== Hocuspocus Hooks & Extensions =====

  private async handleAuthenticate(data: onAuthenticatePayload) {
    const { token, documentName } = data;
    if (!token) throw new Error('Unauthorized');

    try {
      const payload = await this.verifyToken(token);
      const { page, readOnly } = await this.resolvePageAndPermission(
        documentName,
        payload.sub,
      );

      data.context.page = page;
      data.connectionConfig.readOnly = readOnly;

      return { user: payload }; // return user to ws auth context session
    } catch (error) {
      this.logger.error(`WebSocket auth failed: ${error.message}`);
      throw error;
    }
  }

  private getRedisExtension(): any {
    // cast: @hocuspocus/extension-redis phụ thuộc @hocuspocus/server version
    // khác (4.7) với bản root (4.1) — type không khớp nhưng runtime tương thích.
    return new Redis({
      host: process.env.NOTE_HOCUSPOCUS_REDIS_HOST || 'localhost',
      port: parseInt(process.env.NOTE_HOCUSPOCUS_REDIS_PORT || '6380', 10),
    });
  }

  private getDatabaseExtension() {
    return new Database({
      fetch: this.handleFetchDocument.bind(this),
      store: this.handleStoreDocument.bind(this),
    });
  }

  // ===== Database Handlers =====

  private async handleFetchDocument({
    documentName,
    context,
  }: fetchPayload): Promise<Uint8Array | null> {
    const page =
      context.page ??
      (await this.pagesRepo.findOne({ where: { id: documentName } }));

    if (!page) return null;

    const doc = await this.pageDocumentsRepo.findOne({
      where: { pageId: page.id },
    });

    return doc?.data ?? null;
  }

  private async handleStoreDocument({
    documentName,
    state,
    document,
  }: storePayload): Promise<void> {
    await this.pageDocumentsRepo.upsert(
      { pageId: documentName, data: Buffer.from(state) },
      ['pageId'],
    );

    // Eventual sync → Blocks table (cho search)
    this.yjsBlocksSyncService
      .syncFromYdoc(documentName, document)
      .catch((err) =>
        this.logger.error(`Blocks sync failed for ${documentName}:`, err),
      );
  }

  // ===== Auth Helpers =====

  private async verifyToken(token: string): Promise<Record<string, any>> {
    const payload = await this.jwtService.verifyAsync(token, {
      secret: process.env.JWT_SECRET || 'fallback_secret',
    });

    const isBlacklisted = await this.authCache.isBlacklisted(token);
    if (isBlacklisted) throw new Error('Unauthorized');

    const currentVersion = await this.authCache.getUserTokenVersion(
      payload.sub,
    );
    if (payload.tokenVersion !== currentVersion) {
      throw new Error('Unauthorized');
    }

    return payload;
  }

  private async resolvePageAndPermission(
    pageId: string,
    userId: string,
  ): Promise<{ page: PagesEntity; readOnly: boolean }> {
    const page = await this.pagesRepo.findOne({ where: { id: pageId } });
    if (!page) {
      throw new Error('Page not found');
    }

    const permission = await this.permissionsService.getUserPermissionByPage(
      pageId,
      userId,
    );
    if (!permission && !page.isPublic) {
      throw new Error('Access denied');
    }

    return {
      page,
      readOnly: permission !== PermissionType.Edit,
    };
  }
}
