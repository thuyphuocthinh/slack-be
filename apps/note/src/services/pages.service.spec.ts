import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Brackets } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { NOTE_ERROR } from '@slack/constants/errors';
import { PagesService } from './pages.service';
import { PagesEntity } from '../entity/pages.entity';
import { PermissionsService } from './permissions.service';
import { PermissionType } from '../types/permission.types';
import { PageType } from '../types/pages.types';
import { CachedService } from '@slack/cached';

describe('PagesService', () => {
  let service: PagesService;
  let pagesRepo: any;
  let permissionsService: any;
  let cachedService: any;

  const OWNER_ID = 'owner-1';
  const EDITOR_ID = 'editor-1';
  const STRANGER_ID = 'stranger-1';
  const ROOT_ID = 'root-1';

  let mockQueryBuilder: any;

  beforeEach(async () => {
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    pagesRepo = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve(data)),
      softDelete: jest.fn(),
      createQueryBuilder: jest.fn(() => mockQueryBuilder),
    };

    permissionsService = {
      getUserPermissionByPage: jest.fn(),
    };
    // assertPermission ủy quyền qua getUserPermissionByPage đã mock ở trên,
    // để các test case hiện có (mockResolvedValueOnce trên getUserPermissionByPage)
    // không cần sửa gì thêm.
    permissionsService.assertPermission = jest.fn(
      async (pageId: string, userId: string, required: PermissionType) => {
        const permission = await permissionsService.getUserPermissionByPage(
          pageId,
          userId,
        );
        const hasAccess =
          required === PermissionType.Edit
            ? permission === PermissionType.Edit
            : permission !== null;
        if (!hasAccess) {
          throw new RpcException(NOTE_ERROR.ACCESS_DENIED);
        }
      },
    );

    cachedService = {
      invalidateList: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PagesService,
        { provide: getRepositoryToken(PagesEntity), useValue: pagesRepo },
        { provide: PermissionsService, useValue: permissionsService },
        { provide: CachedService, useValue: cachedService },
      ],
    }).compile();

    service = module.get<PagesService>(PagesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPage', () => {
    it('should create a root page with depth 0 and a path containing its own generated id', async () => {
      const result = await service.createPage({
        userId: OWNER_ID,
        workspaceId: 'ws-1',
        title: 'My root page',
      } as any);

      expect(pagesRepo.save).toHaveBeenCalled();
      const saved = (pagesRepo.save as jest.Mock).mock.calls[0][0];
      expect(saved.depth).toBe(0);
      expect(saved.path).toBe(`/${saved.id}`);
      expect(result.title).toBe('My root page');
    });

    it('should default isPublic to false when not provided', async () => {
      await service.createPage({
        userId: OWNER_ID,
        workspaceId: 'ws-1',
      } as any);

      const saved = (pagesRepo.save as jest.Mock).mock.calls[0][0];
      expect(saved.isPublic).toBe(false);
    });

    it('should throw PAGE_NOT_FOUND when parentId does not exist', async () => {
      pagesRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.createPage({
          userId: OWNER_ID,
          workspaceId: 'ws-1',
          parentId: 'missing-parent',
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.PAGE_NOT_FOUND));
    });

    it('should throw ACCESS_DENIED when caller does not have Edit on the parent page', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        id: ROOT_ID,
        depth: 0,
        path: `/${ROOT_ID}`,
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.View,
      );

      await expect(
        service.createPage({
          userId: STRANGER_ID,
          workspaceId: 'ws-1',
          parentId: ROOT_ID,
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should create a child page with depth+1 and path nested under the parent when caller has Edit', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        id: ROOT_ID,
        depth: 0,
        path: `/${ROOT_ID}`,
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.Edit,
      );

      await service.createPage({
        userId: EDITOR_ID,
        workspaceId: 'ws-1',
        parentId: ROOT_ID,
      } as any);

      const saved = (pagesRepo.save as jest.Mock).mock.calls[0][0];
      expect(saved.depth).toBe(1);
      expect(saved.path).toBe(`/${ROOT_ID}/${saved.id}`);
    });

    it('should allow choosing PageType.Database', async () => {
      await service.createPage({
        userId: OWNER_ID,
        workspaceId: 'ws-1',
        type: PageType.Database,
      } as any);

      const saved = (pagesRepo.save as jest.Mock).mock.calls[0][0];
      expect(saved.type).toBe(PageType.Database);
    });
  });

  describe('updatePage', () => {
    it('should throw PAGE_NOT_FOUND when the page does not exist', async () => {
      pagesRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updatePage({
          id: 'missing',
          userId: OWNER_ID,
          title: 'x',
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.PAGE_NOT_FOUND));
    });

    it('should throw ACCESS_DENIED when caller only has View permission', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        id: ROOT_ID,
        userId: OWNER_ID,
        title: 'old',
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.View,
      );

      await expect(
        service.updatePage({
          id: ROOT_ID,
          userId: STRANGER_ID,
          title: 'new',
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should allow an editor (not the owner) with Edit permission to update', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        id: ROOT_ID,
        userId: OWNER_ID,
        title: 'old',
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.Edit,
      );

      const result = await service.updatePage({
        id: ROOT_ID,
        userId: EDITOR_ID,
        title: 'new title',
      } as any);

      expect(result.title).toBe('new title');
    });

    it('should not overwrite a field that was not sent in the request', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        id: ROOT_ID,
        userId: OWNER_ID,
        title: 'old title',
        favicon: 'old-favicon',
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.Edit,
      );

      // favicon không được gửi trong request -> phải giữ nguyên giá trị cũ
      const result = await service.updatePage({
        id: ROOT_ID,
        userId: OWNER_ID,
        title: 'new title',
      } as any);

      expect(result.title).toBe('new title');
      expect(result.favicon).toBe('old-favicon');
    });

    it('should bump the permission version tracker when isPublic changes', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        id: ROOT_ID,
        userId: OWNER_ID,
        title: 'old',
        isPublic: false,
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.Edit,
      );

      await service.updatePage({
        id: ROOT_ID,
        userId: OWNER_ID,
        isPublic: true,
      } as any);

      // isPublic đổi hiệu lực cho MỌI user, không riêng ai -> bump version thay
      // vì xoá key theo (pageId, userId) cụ thể.
      expect(cachedService.invalidateList).toHaveBeenCalledWith(
        expect.stringContaining(ROOT_ID),
      );
    });

    it('should not touch the permission cache when isPublic is not part of the update', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        id: ROOT_ID,
        userId: OWNER_ID,
        title: 'old',
        isPublic: false,
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.Edit,
      );

      await service.updatePage({
        id: ROOT_ID,
        userId: OWNER_ID,
        title: 'new title',
      } as any);

      expect(cachedService.invalidateList).not.toHaveBeenCalled();
    });
  });

  describe('getDetailPage', () => {
    it('should throw PAGE_NOT_FOUND when the page does not exist', async () => {
      pagesRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.getDetailPage(STRANGER_ID, 'missing'),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.PAGE_NOT_FOUND));
    });

    it('should throw ACCESS_DENIED when caller has no permission at all (null)', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        id: ROOT_ID,
        userId: OWNER_ID,
        title: 'Doc',
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(null);

      await expect(service.getDetailPage(STRANGER_ID, ROOT_ID)).rejects.toThrow(
        new RpcException(NOTE_ERROR.ACCESS_DENIED),
      );
    });

    it('should return the page when caller only has View permission', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        id: ROOT_ID,
        userId: OWNER_ID,
        title: 'Doc',
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.View,
      );

      const result = await service.getDetailPage(STRANGER_ID, ROOT_ID);

      expect(result.title).toBe('Doc');
    });
  });

  describe('deletePage', () => {
    it('should throw PAGE_NOT_FOUND when the page does not exist', async () => {
      pagesRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.deletePage({ id: 'missing', userId: OWNER_ID }),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.PAGE_NOT_FOUND));
    });

    it('should throw ACTION_DENIED when caller is not the owner', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        id: ROOT_ID,
        userId: OWNER_ID,
      });

      await expect(
        service.deletePage({ id: ROOT_ID, userId: STRANGER_ID }),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACTION_DENIED));
    });

    it('should delete successfully when caller is the owner', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        id: ROOT_ID,
        userId: OWNER_ID,
      });

      await service.deletePage({ id: ROOT_ID, userId: OWNER_ID });

      expect(pagesRepo.softDelete).toHaveBeenCalledWith(ROOT_ID);
    });
  });

  describe('queryPages', () => {
    it('should filter by parentId when provided', async () => {
      await service.queryPages({
        workspaceId: 'ws-1',
        userId: OWNER_ID,
        parentId: ROOT_ID,
      } as any);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'page.parentId = :parentId',
        { parentId: ROOT_ID },
      );
    });

    it('should filter root-only pages when rootOnly=true and no parentId given', async () => {
      await service.queryPages({
        workspaceId: 'ws-1',
        userId: OWNER_ID,
        rootOnly: true,
      } as any);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'page.parentId IS NULL',
      );
    });

    it('should not restrict by parent at all when neither parentId nor rootOnly is given', async () => {
      await service.queryPages({
        workspaceId: 'ws-1',
        userId: OWNER_ID,
      } as any);

      const calls = mockQueryBuilder.andWhere.mock.calls.map(
        (c: any[]) => c[0],
      );
      expect(calls).not.toContain('page.parentId IS NULL');
      expect(calls.some((c: string) => c.includes('page.parentId ='))).toBe(
        false,
      );
    });

    it('should apply a full-text search filter across page title and block content when keyword is provided', async () => {
      await service.queryPages({
        workspaceId: 'ws-1',
        userId: OWNER_ID,
        keyword: 'Q3 plan',
      } as any);

      const bracketsCall = mockQueryBuilder.andWhere.mock.calls.find(
        (c: any[]) => c[0] instanceof Brackets,
      );
      expect(bracketsCall).toBeDefined();

      // Brackets chỉ build được lời gọi where/orWhere thật khi chạy trên
      // SelectQueryBuilder thật — ở đây tự invoke whereFactory với 1 fake
      // builder để assert đúng 2 nhánh OR (title vs block content).
      const fakeQb = {
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
      };
      bracketsCall[0].whereFactory(fakeQb);

      expect(fakeQb.where).toHaveBeenCalledWith(
        `to_tsvector('simple', page.title) @@ to_tsquery('simple', :formattedKeyword)`,
        { formattedKeyword: 'Q3:* & plan:*' }, // code không lowercase, giữ nguyên case gốc
      );
      expect(fakeQb.orWhere).toHaveBeenCalledWith(
        expect.stringContaining("to_tsvector('simple', b.content_text)"),
        { formattedKeyword: 'Q3:* & plan:*' },
      );
    });

    it('should skip the keyword filter when the cleaned keyword becomes empty', async () => {
      await service.queryPages({
        workspaceId: 'ws-1',
        userId: OWNER_ID,
        keyword: '&&&',
      } as any);

      const calls = mockQueryBuilder.andWhere.mock.calls.map(
        (c: any[]) => c[0],
      );
      expect(calls.some((c: string) => c.includes('to_tsvector'))).toBe(false);
    });

    it('should apply createdFrom/createdTo filters', async () => {
      await service.queryPages({
        workspaceId: 'ws-1',
        userId: OWNER_ID,
        createdFrom: '2026-01-01T00:00:00.000Z',
        createdTo: '2026-12-31T23:59:59.000Z',
      } as any);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'page.createdAt >= :createdFrom',
        {
          createdFrom: '2026-01-01T00:00:00.000Z',
        },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'page.createdAt <= :createdTo',
        {
          createdTo: '2026-12-31T23:59:59.000Z',
        },
      );
    });

    it('should return a paginated IOffsetResponse shape', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValueOnce([
        [
          { id: 'p1', title: 'A' },
          { id: 'p2', title: 'B' },
        ],
        42,
      ]);

      const result: any = await service.queryPages({
        workspaceId: 'ws-1',
        userId: OWNER_ID,
        page: 2,
        limit: 10,
      } as any);

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(10); // (page-1)*limit
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(result.data).toHaveLength(2);
      expect(result.paging).toEqual({
        page: 2,
        limit: 10,
        total: 42,
        totalPages: 5,
      });
    });
  });
});
