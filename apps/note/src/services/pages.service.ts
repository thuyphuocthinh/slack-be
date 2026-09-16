import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  IsNull,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
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
import { GetTrashedPagesDto } from '../dto/get-trashed-pages.dto';
import { RestorePageDto } from '../dto/restore-page.dto';
import { DuplicatePageDto } from '../dto/duplicate-page.dto';
import { MovePageDto } from '../dto/move-page.dto';
import { IOffsetResponse } from '@slack/common';
import { CACHE, CachedService } from '@slack/cached';
import { stripUndefined } from '../utils/object.util';
import { BlocksService } from './blocks.service';

@Injectable()
export class PagesService {
  private readonly logger = new Logger(PagesService.name);

  constructor(
    @InjectRepository(PagesEntity)
    private readonly pagesRepo: Repository<PagesEntity>,
    private readonly permissionsService: PermissionsService,
    private readonly cachedService: CachedService,
    private readonly blocksService: BlocksService,
    private readonly dataSource: DataSource,
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
    qb.orderBy('page.order', 'ASC')
      .addOrderBy('page.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

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

      // 4. order = số anh em hiện có -> luôn thêm vào CUỐI danh sách, khớp
      // invariant "order reindex liên tục 0..n-1" mà movePage duy trì.
      const order = await this.pagesRepo.count({
        where: { workspaceId, parentId: parentId ? parentId : IsNull() },
      });

      // 5. Tạo page
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
        order: order,
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
  async deletePage(deletePage: DeletePageDto): Promise<{ success: true }> {
    try {
      const { id, userId } = deletePage;

      const page = await this.pagesRepo.findOne({ where: { id } });

      if (!page) {
        throw new RpcException(NOTE_ERROR.PAGE_NOT_FOUND);
      }

      if (page.userId !== userId) {
        throw new RpcException(NOTE_ERROR.ACTION_DENIED);
      }

      // softDelete, không delete — entity có DeleteDateColumn nên mọi
      // findOne/queryBuilder khác đã tự loại trừ deletedAt != null.
      await this.pagesRepo.softDelete(id);
      this.logger.debug(`Page deleted successfully: ${id}`);

      return { success: true };
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

      // stripUndefined: ValidationPipe tạo DTO có sẵn mọi field = undefined dù
      // không gửi lên -> Object.assign thẳng sẽ đè mất giá trị cũ trong entity.
      Object.assign(page, stripUndefined(updateData));

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

  // trash — chỉ trang do chính người gọi sở hữu, vì delete cũng chỉ owner làm được.
  async getTrashedPages(dto: GetTrashedPagesDto): Promise<PageResponseDto[]> {
    try {
      const { workspaceId, userId } = dto;
      const pages = await this.pagesRepo
        .createQueryBuilder('page')
        .withDeleted()
        .where('page.workspaceId = :workspaceId', { workspaceId })
        .andWhere('page.userId = :userId', { userId })
        .andWhere('page.deletedAt IS NOT NULL')
        .orderBy('page.deletedAt', 'DESC')
        .getMany();

      return pages.map((p) => this.mapToResponse(p));
    } catch (error) {
      this.logger.error(`Error getting trashed pages:`, error);
      throw error;
    }
  }

  // restore — chỉ owner, khớp rule deletePage (chỉ owner mới xoá được).
  async restorePage(dto: RestorePageDto): Promise<{ success: true }> {
    try {
      const { id, userId } = dto;
      const page = await this.pagesRepo.findOne({
        where: { id },
        withDeleted: true,
      });

      if (!page || !page.deletedAt) {
        throw new RpcException(NOTE_ERROR.PAGE_NOT_FOUND);
      }

      if (page.userId !== userId) {
        throw new RpcException(NOTE_ERROR.ACTION_DENIED);
      }

      await this.pagesRepo.restore(id);
      this.logger.debug(`Page restored: ${id}`);

      return { success: true };
    } catch (error) {
      this.logger.error(`Error restoring page:`, error);
      throw error;
    }
  }

  // duplicate — chỉ cần View trên page gốc. Bản duplicate luôn là page GỐC
  // (root) do chính người bấm duplicate làm chủ, KHÔNG nhân bản subtree con —
  // tránh phải xử lý quyền Edit trên parent (có thể không phải của mình) và
  // giữ scope đơn giản, nhanh.
  async duplicatePage(dto: DuplicatePageDto): Promise<PageResponseDto> {
    try {
      const { id, userId } = dto;
      const original = await this.pagesRepo.findOne({ where: { id } });

      if (!original) {
        throw new RpcException(NOTE_ERROR.PAGE_NOT_FOUND);
      }

      await this.permissionsService.assertPermission(
        id,
        userId,
        PermissionType.View,
      );

      const newId = uuidv4();
      const newPage = this.pagesRepo.create({
        id: newId,
        title: `${original.title || 'Untitled'} (Copy)`,
        favicon: original.favicon,
        coverImage: original.coverImage,
        userId,
        workspaceId: original.workspaceId,
        type: original.type,
        isPublic: false,
        depth: 0,
        path: `/${newId}`,
      });

      await this.pagesRepo.save(newPage);
      await this.blocksService.duplicateForPage(id, newId);

      this.logger.debug(`Page duplicated: ${id} -> ${newId}`);
      return this.mapToResponse(newPage);
    } catch (error) {
      this.logger.error(`Error duplicating page:`, error);
      throw error;
    }
  }

  // move — đổi cha và/hoặc vị trí trong danh sách anh em.
  async movePage(dto: MovePageDto): Promise<PageResponseDto> {
    try {
      const { id, userId, newIndex } = dto;
      const newParentId = dto.newParentId ?? null;

      const page = await this.pagesRepo.findOne({ where: { id } });
      if (!page) {
        throw new RpcException(NOTE_ERROR.PAGE_NOT_FOUND);
      }
      await this.permissionsService.assertPermission(
        id,
        userId,
        PermissionType.Edit,
      );

      const newParentPage = await this.resolveMoveTarget(
        page,
        newParentId,
        userId,
      );

      const oldParentId = page.parentId;
      const isReparenting = oldParentId !== newParentId;
      const newDepth = newParentPage ? newParentPage.depth + 1 : 0;
      const newPath = newParentPage ? `${newParentPage.path}/${id}` : `/${id}`;

      await this.dataSource.transaction(async (manager) => {
        if (isReparenting) {
          await manager.update(PagesEntity, id, {
            parentId: newParentId,
            path: newPath,
            depth: newDepth,
          });

          // Hậu duệ giữ path/depth tính theo path/depth CŨ của page — dịch
          // tiền tố path + cộng dồn depthDelta cho cả subtree trong 1 UPDATE.
          await manager.query(
            `UPDATE pages
             SET path = $1 || SUBSTRING(path FROM $2), depth = depth + $3
             WHERE path LIKE $4`,
            [
              newPath,
              page.path.length + 1,
              newDepth - page.depth,
              `${page.path}/%`,
            ],
          );
        }

        await this.reindexSiblings(
          manager,
          page.workspaceId,
          newParentId,
          id,
          newIndex,
        );
        if (isReparenting) {
          await this.reindexSiblings(manager, page.workspaceId, oldParentId);
        }
      });

      // Path đổi -> permission kế thừa của page + hậu duệ đổi theo -> bump
      // cache cả subtree (giống PermissionsService.toggleUserPermissionByPage).
      if (isReparenting) {
        const descendantIds =
          await this.permissionsService.getDescendantPageIds(newPath);
        await this.cachedService.invalidateListBulk(
          [id, ...descendantIds].map((pageId) =>
            CACHE.NOTE.TRACKERS.PAGE_PERMISSION_VERSION(pageId),
          ),
        );
      }

      const moved = await this.pagesRepo.findOne({ where: { id } });
      this.logger.debug(`Page moved: ${id} -> parent=${newParentId}`);
      return this.mapToResponse(moved as PagesEntity);
    } catch (error) {
      this.logger.error(`Error moving page:`, error);
      throw error;
    }
  }

  // Validate + load parent ĐÍCH cho movePage: phải tồn tại, cùng workspace,
  // không phải chính page hay hậu duệ của nó (vòng lặp), và caller có Edit.
  private async resolveMoveTarget(
    page: PagesEntity,
    newParentId: string | null,
    userId: string,
  ): Promise<PagesEntity | null> {
    if (!newParentId) return null;

    const newParentPage = await this.pagesRepo.findOne({
      where: { id: newParentId },
    });
    if (!newParentPage) {
      throw new RpcException(NOTE_ERROR.PAGE_NOT_FOUND);
    }
    if (
      newParentPage.workspaceId !== page.workspaceId ||
      newParentPage.path === page.path ||
      newParentPage.path.startsWith(`${page.path}/`)
    ) {
      throw new RpcException(NOTE_ERROR.ACTION_DENIED);
    }
    await this.permissionsService.assertPermission(
      newParentId,
      userId,
      PermissionType.Edit,
    );

    return newParentPage;
  }

  // Reindex anh em trong 1 nhóm (workspaceId, parentId) thành 0..n-1 liên
  // tục. pinnedPageId + pinnedIndex dời 1 page tới đúng vị trí đó trước khi
  // đánh lại số (pinnedIndex bỏ trống = cuối danh sách); gọi không kèm 2
  // tham số đó để chỉ nén khoảng trống sau khi 1 page đã rời nhóm.
  private async reindexSiblings(
    manager: EntityManager,
    workspaceId: string,
    parentId: string | null,
    pinnedPageId?: string,
    pinnedIndex?: number,
  ): Promise<void> {
    const siblings = await manager
      .createQueryBuilder(PagesEntity, 'page')
      .where('page.workspaceId = :workspaceId', { workspaceId })
      .andWhere(
        parentId === null
          ? 'page.parentId IS NULL'
          : 'page.parentId = :parentId',
        { parentId },
      )
      .orderBy('page.order', 'ASC')
      .getMany();

    if (pinnedPageId) {
      const currentIndex = siblings.findIndex((s) => s.id === pinnedPageId);
      if (currentIndex !== -1) {
        const [pinned] = siblings.splice(currentIndex, 1);
        const clampedIndex = Math.max(
          0,
          Math.min(pinnedIndex ?? siblings.length, siblings.length),
        );
        siblings.splice(clampedIndex, 0, pinned);
      }
    }

    await Promise.all(
      siblings.map((sibling, index) =>
        manager.update(PagesEntity, sibling.id, { order: index }),
      ),
    );
  }
}
