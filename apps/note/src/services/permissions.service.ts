import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PermissionsEntity } from '../entity/permissions.entity';
import { DataSource, Repository } from 'typeorm';
import { PermissionType } from '../types/permission.types';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { PagesEntity } from '../entity/pages.entity';
import { RpcException } from '@nestjs/microservices';
import { NOTE_ERROR } from '@slack/constants/errors';

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    @InjectRepository(PermissionsEntity)
    private readonly permissionsRepo: Repository<PermissionsEntity>,
    @InjectRepository(PagesEntity)
    private readonly pagesRepo: Repository<PagesEntity>,
    private readonly cachedService: CachedService,
    private readonly dataSource: DataSource,
  ) {}

  // share/unshare/đổi type — chỉ owner được gọi. Bọc transaction + pessimistic
  // double-click share/unshare liên tiếp có thể race giữa 2 request cùng lúc.
  async toggleUserPermissionByPage(
    callerId: string,
    pageId: string,
    userId: string,
    type: PermissionType,
  ): Promise<{ success: true }> {
    try {
      let ownerPagePath = '';

      await this.dataSource.transaction(async (manager) => {
        const ownerPage = await manager.findOne(PagesEntity, {
          where: { id: pageId, userId: callerId },
        });

        if (!ownerPage) {
          throw new RpcException(NOTE_ERROR.ACCESS_DENIED);
        }

        ownerPagePath = ownerPage.path;

        const existingPermission = await manager.findOne(PermissionsEntity, {
          where: { pageId, userId },
          lock: { mode: 'pessimistic_write' },
        });

        if (existingPermission) {
          if (existingPermission.type === type) {
            // bấm lại đúng type đang có -> unshare
            await manager.delete(PermissionsEntity, { pageId, userId });
            this.logger.debug(
              `Deleted permission for user ${userId} on page ${pageId}`,
            );
          } else {
            // đổi type (VD nâng View -> Edit), không xóa mất quyền cũ
            await manager.update(
              PermissionsEntity,
              { pageId, userId },
              { type },
            );
            this.logger.debug(
              `Updated permission for user ${userId} on page ${pageId} to ${type}`,
            );
          }
        } else {
          await manager.save(PermissionsEntity, { pageId, userId, type });
          this.logger.debug(
            `Saved permission for user ${userId} on page ${pageId}`,
          );
        }
      });

      // Chỉ invalidate cache SAU KHI transaction commit thành công.
      const descendantIds = await this.getDescendantPageIds(ownerPagePath);
      await this.cachedService.invalidateListBulk(
        [pageId, ...descendantIds].map((id) =>
          CACHE.NOTE.TRACKERS.PAGE_PERMISSION_VERSION(id),
        ),
      );

      return { success: true };
    } catch (error) {
      this.logger.error(
        `Error toggling permission for user ${userId} on page ${pageId}:`,
        error,
      );
      throw error;
    }
  }

  // get quyền thật (owner, hoặc share tường minh tại chính page/page tổ tiên)
  async getUserPermissionByPage(
    pageId: string,
    userId: string,
  ): Promise<PermissionType | null> {
    try {
      const version = await this.cachedService.getVersion(
        CACHE.NOTE.TRACKERS.PAGE_PERMISSION_VERSION(pageId),
      );
      const result =
        await this.cachedService.getOrSetDetailNullable<PermissionType>(
          CACHE.NOTE.KEYS.USER_PERMISSIONS(pageId, userId, version),
          TTL.SHORT,
          async () => this.resolvePermissionOptimized(pageId, userId),
        );

      this.logger.debug(
        `User ${userId} on page ${pageId} has permission: ${result}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Error checking permission for user ${userId} on page ${pageId}:`,
        error,
      );
      throw error;
    }
  }

  // Dùng ở mọi service khác thay vì tự viết if/throw lặp lại (khớp pattern
  // WorkspaceCommonService.checkPermission — tự throw bên trong, nơi gọi 1 dòng).
  // required = View: có bất kỳ quyền nào (View hoặc Edit) cũng pass, vì Edit ⊇ View.
  // required = Edit: bắt buộc đúng Edit.
  async assertPermission(
    pageId: string,
    userId: string,
    required: PermissionType,
  ): Promise<void> {
    const permission = await this.getUserPermissionByPage(pageId, userId);
    const hasAccess =
      required === PermissionType.Edit
        ? permission === PermissionType.Edit
        : permission !== null;

    if (!hasAccess) {
      throw new RpcException(NOTE_ERROR.ACCESS_DENIED);
    }
  }

  // BẢN NAIVE — walk-up cây, tối đa `depth` query. Giữ lại (không xóa) để load-test
  // so sánh trước/sau với bản optimized bên dưới, đúng bài đo tải docs.md mục 3.3.
  private async resolvePermissionNaive(
    pageId: string,
    userId: string,
  ): Promise<PermissionType | null> {
    let currentPageId: string | null = pageId;

    while (currentPageId) {
      const page = await this.pagesRepo.findOne({
        where: { id: currentPageId },
      });
      if (!page) return null;

      if (page.userId === userId) {
        return PermissionType.Edit; // owner luôn có quyền Edit
      }

      const permission = await this.permissionsRepo.findOne({
        where: { pageId: currentPageId, userId },
      });
      if (permission) {
        return permission.type;
      }

      currentPageId = page.parentId;
    }

    return null;
  }

  // BẢN OPTIMIZED — dùng materialized path (Pages.path) để lấy hết tổ tiên trong
  // đúng 2 query (không phụ thuộc độ sâu cây) thay vì tối đa `depth` query tuần tự.
  private async resolvePermissionOptimized(
    pageId: string,
    userId: string,
  ): Promise<PermissionType | null> {
    const page = await this.pagesRepo.findOne({
      where: { id: pageId },
      select: ['path', 'isPublic'],
    });
    if (!page) return null;

    // path dạng "/rootId/.../pageId" — tách ra list id, đảo ngược để ưu tiên tổ
    // tiên GẦN NHẤT trước (khớp semantics bản naive: "gần nhất thắng").
    const ancestorIds = page.path.split('/').filter(Boolean).reverse();
    if (ancestorIds.length === 0) {
      return page.isPublic ? PermissionType.View : null;
    }

    const rows = await this.pagesRepo
      .createQueryBuilder('page')
      .leftJoin(
        PermissionsEntity,
        'perm',
        'perm.pageId = page.id AND perm.userId = :userId',
        { userId },
      )
      .select('page.id', 'id')
      .addSelect('page.userId', 'ownerId')
      .addSelect('perm.type', 'permType')
      .where('page.id IN (:...ancestorIds)', { ancestorIds })
      .getRawMany<{
        id: string;
        ownerId: string;
        permType: PermissionType | null;
      }>();

    const byId = new Map(rows.map((r) => [r.id, r]));

    for (const id of ancestorIds) {
      const row = byId.get(id);
      if (!row) continue;
      if (row.ownerId === userId) return PermissionType.Edit;
      if (row.permType) return row.permType;
    }

    // Không tìm thấy quyền tường minh nào trong cây tổ tiên — vẫn xem được nếu
    // CHÍNH page này (không kế thừa isPublic từ tổ tiên) được set public, khớp
    // semantics của Hocuspocus gateway (note/hocuspocus.gateway.ts) vốn cũng chỉ
    // check page.isPublic của đúng page đang mở, không kế thừa.
    return page.isPublic ? PermissionType.View : null;
  }

  // Liệt kê ai đang được share tường minh trên ĐÚNG page này (không kế thừa từ
  // tổ tiên) — dùng cho UI Share hiển thị danh sách đã share. Chỉ cần View để
  // xem (owner luôn thấy, người được share View/Edit cũng thấy).
  async getPermissionsByPage(
    pageId: string,
    callerId: string,
  ): Promise<{
    ownerId: string;
    shares: { userId: string; type: PermissionType }[];
  }> {
    const page = await this.pagesRepo.findOne({
      where: { id: pageId },
      select: ['id', 'userId'],
    });
    if (!page) {
      throw new RpcException(NOTE_ERROR.PAGE_NOT_FOUND);
    }

    await this.assertPermission(pageId, callerId, PermissionType.View);

    const rows = await this.permissionsRepo.find({ where: { pageId } });

    return {
      ownerId: page.userId,
      shares: rows.map((r) => ({ userId: r.userId, type: r.type })),
    };
  }

  // Dùng khi 1 thay đổi ảnh hưởng cả subtree (share/unshare permission, move
  // page) — quyền kế thừa xuống page con nên phải invalidate cache toàn bộ
  // subtree chứ không chỉ đúng page đó. Public để PagesService.movePage dùng lại.
  async getDescendantPageIds(path: string): Promise<string[]> {
    const rows = await this.pagesRepo
      .createQueryBuilder('page')
      .select('page.id', 'id')
      .where('page.path LIKE :prefix', { prefix: `${path}/%` })
      .getRawMany<{ id: string }>();

    return rows.map((r) => r.id);
  }
}
