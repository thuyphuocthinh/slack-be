import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import { PagesEntity } from '../entity/pages.entity';
import { RpcException } from '@nestjs/microservices';
import { NOTE_ERROR } from '@slack/constants/errors';
import { CreatePageDto } from '../dto/create-page.dto';
import { plainToInstance } from 'class-transformer';
import { PageResponseDto } from '../dto/page-response.dto';
import { UpdatePageDto } from '../dto/update-page.dto';
import { v4 as uuidv4 } from 'uuid';
import { PermissionsService } from './permissions.service';
import { PermissionType } from '../types/permission.types';
import { DeletePageDto } from '../dto/delete-page.dto';
import { QueryPagesDto } from '../dto/query-pages.dto';
import { IOffsetResponse } from '@slack/common';
import { CACHE, CachedService } from '@slack/cached';

@Injectable()
export class PagesService {
  private readonly logger = new Logger(PagesService.name);

  constructor(
    @InjectRepository(PagesEntity)
    private readonly pagesRepo: Repository<PagesEntity>,
    private readonly permissionsService: PermissionsService,
    private readonly cachedService: CachedService,
  ) {}

  private mapToResponse(page: PagesEntity): PageResponseDto {
    return plainToInstance(PageResponseDto, page, {
      excludeExtraneousValues: true,
    });
  }

  // Chỉ lọc theo: public, owner, hoặc có row Permissions tại ĐÚNG page này.
  // CHƯA xử lý quyền kế thừa từ page tổ tiên (walk-up như permissions.service.ts)
  // vì per-row walk-up trên cả list/search sẽ N+1 query — cần path/materialized
  // path (xem db.md mục 3.3) mới lọc được kế thừa hiệu quả trong 1 query.
  private applyPermissionFilter(
    qb: SelectQueryBuilder<PagesEntity>,
    userId: string,
  ): SelectQueryBuilder<PagesEntity> {
    return qb.andWhere(
      `(page.isPublic = true
              OR page.userId = :userId
              OR EXISTS (
                SELECT 1 FROM permissions perm
                WHERE perm.page_id = page.id AND perm.user_id = :userId
              ))`,
      { userId },
    );
  }

  // Offset pagination — khớp chuẩn chung của notification.service.ts:fetchNotifications
  // (skip/take + getManyAndCount, response IOffsetResponse<T>), không tự chế cursor riêng.
  private async paginate(
    qb: SelectQueryBuilder<PagesEntity>,
    page: number,
    limit: number,
  ): Promise<IOffsetResponse<PageResponseDto[]>> {
    const skip = (page - 1) * limit;
    qb.orderBy('page.createdAt', 'DESC').skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      data: items.map((p) => this.mapToResponse(p)),
      paging: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    } as unknown as IOffsetResponse<PageResponseDto[]>;
  }

  // create page
  async createPage(createPage: CreatePageDto): Promise<PageResponseDto> {
    try {
      const { title, userId, workspaceId, parentId, type, isPublic } =
        createPage;

      // 1. Xác định parentPage + check quyền Edit trên page cha (nếu có)
      let parentPage: PagesEntity | null = null;
      if (parentId) {
        parentPage = await this.pagesRepo.findOne({ where: { id: parentId } });

        if (!parentPage) {
          throw new RpcException(NOTE_ERROR.PAGE_NOT_FOUND);
        }

        await this.permissionsService.assertPermission(
          parentId,
          userId,
          PermissionType.Edit,
        );
      }

      // 2. Sinh id trước — path cần chứa id của CHÍNH page này, mà id chỉ có
      // sau khi insert nếu để DB tự generate, nên phải tự sinh UUID ở đây.
      const id = uuidv4();

      // 3. Tính toán path & depth
      // depth: 0 nếu root, 1 nếu con của root, 2 nếu con của con...
      const depth = parentPage ? parentPage.depth + 1 : 0;
      const path = parentPage ? `${parentPage.path}/${id}` : `/${id}`;

      // 4. Tạo page
      const page = this.pagesRepo.create({
        id,
        title: title ?? 'Untitled Page',
        userId: userId,
        workspaceId: workspaceId,
        parentId: parentId,
        type: type,
        isPublic: isPublic ?? false,
        depth: depth,
        path: path,
      });

      await this.pagesRepo.save(page);
      this.logger.debug(`Page created successfully: ${page.id}`);
      return this.mapToResponse(page);
    } catch (error) {
      this.logger.error(`Error creating page:`, error);
      throw error;
    }
  }

  // query pages — gộp list + search làm 1, filter nào không truyền thì bỏ qua
  // (khớp pattern fetchNotifications, không tách method theo use case)
  async queryPages(
    query: QueryPagesDto,
  ): Promise<IOffsetResponse<PageResponseDto[]>> {
    try {
      const {
        workspaceId,
        userId,
        parentId,
        rootOnly,
        keyword,
        createdFrom,
        createdTo,
        page = 1,
        limit = 20,
      } = query;

      let qb = this.pagesRepo
        .createQueryBuilder('page')
        .where('page.workspaceId = :workspaceId', { workspaceId });

      if (parentId) {
        qb.andWhere('page.parentId = :parentId', { parentId });
      } else if (rootOnly) {
        qb.andWhere('page.parentId IS NULL');
      }

      if (keyword) {
        // Full-text search theo từ (GIN index trên to_tsvector, xem migration
        // AddPagesTitleFtsIndex) thay vì ILIKE '%...%' — ILIKE có wildcard đầu
        // nên không dùng được index thường, phải seq-scan toàn bảng.
        // Match title HOẶC bất kỳ block nào của page — Blocks.contentText là text
        // phẳng maintain sẵn (xem utils/prosemirror.util.ts + migration
        // AddBlocksContentTextFtsIndex), vì content gốc là JSONB lồng sâu không
        // to_tsvector trực tiếp được.
        const formattedKeyword = keyword
          .trim()
          .replace(/[&|!():*]/g, '')
          .split(/\s+/)
          .filter((word) => word.length > 0)
          .map((word) => `${word}:*`)
          .join(' & ');

        if (formattedKeyword) {
          qb.andWhere(
            new Brackets((qb2) => {
              qb2
                .where(
                  `to_tsvector('simple', page.title) @@ to_tsquery('simple', :formattedKeyword)`,
                  { formattedKeyword },
                )
                .orWhere(
                  `EXISTS (
                    SELECT 1 FROM blocks b
                    WHERE b.page_id = page.id
                      AND b.deleted_at IS NULL
                      AND to_tsvector('simple', b.content_text) @@ to_tsquery('simple', :formattedKeyword)
                  )`,
                  { formattedKeyword },
                );
            }),
          );
        }
      }

      if (createdFrom) {
        qb.andWhere('page.createdAt >= :createdFrom', { createdFrom });
      }

      if (createdTo) {
        qb.andWhere('page.createdAt <= :createdTo', { createdTo });
      }

      qb = this.applyPermissionFilter(qb, userId);

      return await this.paginate(qb, page, limit);
    } catch (error) {
      this.logger.error(`Error querying pages:`, error);
      throw error;
    }
  }

  async getDetailPage(
    callerId: string,
    pageId: string,
  ): Promise<PageResponseDto> {
    try {
      const page = await this.pagesRepo.findOne({ where: { id: pageId } });

      if (!page) {
        throw new RpcException(NOTE_ERROR.PAGE_NOT_FOUND);
      }

      await this.permissionsService.assertPermission(
        pageId,
        callerId,
        PermissionType.View,
      );

      // TODO: cache get page detail

      return this.mapToResponse(page);
    } catch (error) {
      this.logger.error(`Error getting page detail:`, error);
      throw error;
    }
  }

  // delete page
  async deletePage(deletePage: DeletePageDto): Promise<void> {
    try {
      const { id, userId } = deletePage;

      const page = await this.pagesRepo.findOne({ where: { id } });

      if (!page) {
        throw new RpcException(NOTE_ERROR.PAGE_NOT_FOUND);
      }

      if (page.userId !== userId) {
        throw new RpcException(NOTE_ERROR.ACTION_DENIED);
      }

      await this.pagesRepo.delete(id);
      this.logger.debug(`Page deleted successfully: ${id}`);
    } catch (error) {
      this.logger.error(`Error deleting page:`, error);
      throw error;
    }
  }

  // update page
  async updatePage(updatePage: UpdatePageDto): Promise<PageResponseDto> {
    try {
      const { id, userId, ...updateData } = updatePage;

      const page = await this.pagesRepo.findOne({ where: { id } });

      if (!page) {
        throw new RpcException(NOTE_ERROR.PAGE_NOT_FOUND);
      }

      await this.permissionsService.assertPermission(
        id,
        userId,
        PermissionType.Edit,
      );

      // field không gửi sẽ không tồn tại như key trên DTO -> Object.assign tự bỏ qua,
      // không đè mất giá trị cũ (khớp pattern task.service.ts:updateTaskDetails)
      Object.assign(page, updateData);

      await this.pagesRepo.save(page);

      // isPublic ảnh hưởng permission hiệu lực của MỌI user (không riêng ai) —
      // không biết đã cache cho những user nào nên bump version thay vì xoá
      // từng key theo (pageId, userId) như PermissionsService.toggleUserPermissionByPage.
      if ('isPublic' in updateData) {
        await this.cachedService.invalidateList(
          CACHE.NOTE.TRACKERS.PAGE_PERMISSION_VERSION(id),
        );
      }

      this.logger.debug(`Page updated successfully: ${page.id}`);
      return this.mapToResponse(page);
    } catch (error) {
      this.logger.error(`Error updating page:`, error);
      throw error;
    }
  }
}
