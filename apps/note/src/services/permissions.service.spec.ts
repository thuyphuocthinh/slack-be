import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { CachedService } from '@slack/cached';
import { NOTE_ERROR } from '@slack/constants/errors';
import { PermissionsService } from './permissions.service';
import { PermissionsEntity } from '../entity/permissions.entity';
import { PagesEntity } from '../entity/pages.entity';
import { PermissionType } from '../types/permission.types';

describe('PermissionsService', () => {
  let service: PermissionsService;
  let permissionsRepo: any;
  let pagesRepo: any;
  let cachedService: any;
  let manager: any;

  const OWNER_ID = 'owner-1';
  const OTHER_USER_ID = 'user-2';
  const ROOT_ID = 'root-1';
  const CHILD_ID = 'child-1';

  beforeEach(async () => {
    manager = {
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const mockQueryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      // Mặc định không có descendant nào — getDescendantPageIds() (chạy sau mỗi
      // toggle) cũng đi qua createQueryBuilder() này; test nào cần subtree thật
      // sẽ tự override bằng mockResolvedValueOnce.
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    permissionsRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    pagesRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => mockQueryBuilder),
    };

    cachedService = {
      getVersion: jest.fn().mockResolvedValue(0),
      getOrSetDetailNullable: jest.fn((_key, _ttl, fetcher) => fetcher()),
      invalidateListBulk: jest.fn(),
    };

    const dataSource = {
      transaction: jest.fn((cb) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        {
          provide: getRepositoryToken(PermissionsEntity),
          useValue: permissionsRepo,
        },
        { provide: getRepositoryToken(PagesEntity), useValue: pagesRepo },
        { provide: CachedService, useValue: cachedService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('toggleUserPermissionByPage', () => {
    it('should throw ACCESS_DENIED when caller is not owner', async () => {
      manager.findOne.mockResolvedValueOnce(null); // Pages: not owner

      await expect(
        service.toggleUserPermissionByPage(
          OTHER_USER_ID,
          CHILD_ID,
          OTHER_USER_ID,
          PermissionType.Edit,
        ),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should create a new permission when none exists', async () => {
      manager.findOne
        .mockResolvedValueOnce({
          id: CHILD_ID,
          userId: OWNER_ID,
          path: `/${CHILD_ID}`,
        }) // ownerPage found
        .mockResolvedValueOnce(null); // no existing permission

      await service.toggleUserPermissionByPage(
        OWNER_ID,
        CHILD_ID,
        OTHER_USER_ID,
        PermissionType.View,
      );

      expect(manager.save).toHaveBeenCalledWith(PermissionsEntity, {
        pageId: CHILD_ID,
        userId: OTHER_USER_ID,
        type: PermissionType.View,
      });
      expect(cachedService.invalidateListBulk).toHaveBeenCalled();
    });

    it('should delete the permission when toggled with the same existing type (unshare)', async () => {
      manager.findOne
        .mockResolvedValueOnce({
          id: CHILD_ID,
          userId: OWNER_ID,
          path: `/${CHILD_ID}`,
        })
        .mockResolvedValueOnce({
          pageId: CHILD_ID,
          userId: OTHER_USER_ID,
          type: PermissionType.View,
        });

      await service.toggleUserPermissionByPage(
        OWNER_ID,
        CHILD_ID,
        OTHER_USER_ID,
        PermissionType.View,
      );

      expect(manager.delete).toHaveBeenCalledWith(PermissionsEntity, {
        pageId: CHILD_ID,
        userId: OTHER_USER_ID,
      });
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('should update the type when toggled with a different existing type (upgrade/downgrade)', async () => {
      manager.findOne
        .mockResolvedValueOnce({
          id: CHILD_ID,
          userId: OWNER_ID,
          path: `/${CHILD_ID}`,
        })
        .mockResolvedValueOnce({
          pageId: CHILD_ID,
          userId: OTHER_USER_ID,
          type: PermissionType.View,
        });

      await service.toggleUserPermissionByPage(
        OWNER_ID,
        CHILD_ID,
        OTHER_USER_ID,
        PermissionType.Edit,
      );

      expect(manager.update).toHaveBeenCalledWith(
        PermissionsEntity,
        { pageId: CHILD_ID, userId: OTHER_USER_ID },
        { type: PermissionType.Edit },
      );
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('should bump the permission version tracker for the page and every descendant', async () => {
      manager.findOne
        .mockResolvedValueOnce({
          id: ROOT_ID,
          userId: OWNER_ID,
          path: `/${ROOT_ID}`,
        })
        .mockResolvedValueOnce(null);

      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        { id: CHILD_ID },
        { id: 'grandchild-1' },
      ]);

      await service.toggleUserPermissionByPage(
        OWNER_ID,
        ROOT_ID,
        OTHER_USER_ID,
        PermissionType.View,
      );

      expect(qb.where).toHaveBeenCalledWith('page.path LIKE :prefix', {
        prefix: `/${ROOT_ID}/%`,
      });
      const trackerKeys = cachedService.invalidateListBulk.mock.calls[0][0];
      expect(trackerKeys).toHaveLength(3);
      expect(trackerKeys.some((k: string) => k.includes(ROOT_ID))).toBe(true);
      expect(trackerKeys.some((k: string) => k.includes(CHILD_ID))).toBe(true);
      expect(trackerKeys.some((k: string) => k.includes('grandchild-1'))).toBe(
        true,
      );
    });
  });

  describe('getUserPermissionByPage (resolvePermissionOptimized)', () => {
    it('should return null when the page does not exist', async () => {
      pagesRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.getUserPermissionByPage(
        CHILD_ID,
        OTHER_USER_ID,
      );

      expect(result).toBeNull();
    });

    it('should return Edit when caller owns the page itself', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        path: `/${ROOT_ID}/${CHILD_ID}`,
      });
      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        { id: CHILD_ID, ownerId: OWNER_ID, permType: null },
        { id: ROOT_ID, ownerId: 'someone-else', permType: null },
      ]);

      const result = await service.getUserPermissionByPage(CHILD_ID, OWNER_ID);

      expect(result).toBe(PermissionType.Edit);
    });

    it('should return Edit when caller owns an ancestor page (inherit)', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        path: `/${ROOT_ID}/${CHILD_ID}`,
      });
      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        { id: CHILD_ID, ownerId: 'someone-else', permType: null },
        { id: ROOT_ID, ownerId: OWNER_ID, permType: null },
      ]);

      const result = await service.getUserPermissionByPage(CHILD_ID, OWNER_ID);

      expect(result).toBe(PermissionType.Edit);
    });

    it('should return the explicit permission type shared at an ancestor page', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        path: `/${ROOT_ID}/${CHILD_ID}`,
      });
      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        { id: CHILD_ID, ownerId: 'someone-else', permType: null },
        { id: ROOT_ID, ownerId: 'someone-else', permType: PermissionType.View },
      ]);

      const result = await service.getUserPermissionByPage(
        CHILD_ID,
        OTHER_USER_ID,
      );

      expect(result).toBe(PermissionType.View);
    });

    it('should prioritize the closest ancestor when permissions differ across levels', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        path: `/${ROOT_ID}/${CHILD_ID}`,
      });
      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        {
          id: CHILD_ID,
          ownerId: 'someone-else',
          permType: PermissionType.View,
        },
        { id: ROOT_ID, ownerId: 'someone-else', permType: PermissionType.Edit },
      ]);

      const result = await service.getUserPermissionByPage(
        CHILD_ID,
        OTHER_USER_ID,
      );

      // Child (gần nhất) có View -> phải thắng Edit ở root (xa hơn), dù Edit "cao" hơn
      expect(result).toBe(PermissionType.View);
    });

    it('should return null when there is no permission anywhere in the chain', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        path: `/${ROOT_ID}/${CHILD_ID}`,
      });
      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        { id: CHILD_ID, ownerId: 'someone-else', permType: null },
        { id: ROOT_ID, ownerId: 'someone-else', permType: null },
      ]);

      const result = await service.getUserPermissionByPage(
        CHILD_ID,
        OTHER_USER_ID,
      );

      expect(result).toBeNull();
    });

    it('should return View when the page itself is public and caller has no explicit permission', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({
        path: `/${ROOT_ID}/${CHILD_ID}`,
        isPublic: true,
      });
      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        { id: CHILD_ID, ownerId: 'someone-else', permType: null },
        { id: ROOT_ID, ownerId: 'someone-else', permType: null },
      ]);

      const result = await service.getUserPermissionByPage(
        CHILD_ID,
        OTHER_USER_ID,
      );

      expect(result).toBe(PermissionType.View);
    });

    it('should NOT inherit isPublic from an ancestor page', async () => {
      // isPublic=true nằm ở page CHÍNH nó (CHILD_ID trong path), không phải ở
      // page.isPublic được findOne trả về (chỉ select đúng page đang xét) — nên
      // set false ở đây mô phỏng đúng page đang xét không public, dù ancestor
      // row trong raw query có thể có is_public khác (không được select tới).
      pagesRepo.findOne.mockResolvedValueOnce({
        path: `/${ROOT_ID}/${CHILD_ID}`,
        isPublic: false,
      });
      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        { id: CHILD_ID, ownerId: 'someone-else', permType: null },
        { id: ROOT_ID, ownerId: 'someone-else', permType: null },
      ]);

      const result = await service.getUserPermissionByPage(
        CHILD_ID,
        OTHER_USER_ID,
      );

      expect(result).toBeNull();
    });
  });

  describe('assertPermission', () => {
    it('should not throw when caller has Edit and Edit is required', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({ path: `/${CHILD_ID}` });
      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        { id: CHILD_ID, ownerId: OWNER_ID, permType: null },
      ]);

      await expect(
        service.assertPermission(CHILD_ID, OWNER_ID, PermissionType.Edit),
      ).resolves.toBeUndefined();
    });

    it('should throw ACCESS_DENIED when caller only has View but Edit is required', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({ path: `/${CHILD_ID}` });
      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        {
          id: CHILD_ID,
          ownerId: 'someone-else',
          permType: PermissionType.View,
        },
      ]);

      await expect(
        service.assertPermission(CHILD_ID, OTHER_USER_ID, PermissionType.Edit),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should not throw when caller has only View and View is required', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({ path: `/${CHILD_ID}` });
      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        {
          id: CHILD_ID,
          ownerId: 'someone-else',
          permType: PermissionType.View,
        },
      ]);

      await expect(
        service.assertPermission(CHILD_ID, OTHER_USER_ID, PermissionType.View),
      ).resolves.toBeUndefined();
    });

    it('should throw ACCESS_DENIED when caller has no permission at all', async () => {
      pagesRepo.findOne.mockResolvedValueOnce({ path: `/${CHILD_ID}` });
      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        { id: CHILD_ID, ownerId: 'someone-else', permType: null },
      ]);

      await expect(
        service.assertPermission(CHILD_ID, OTHER_USER_ID, PermissionType.View),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });
  });

  describe('getPermissionsByPage', () => {
    it('should throw PAGE_NOT_FOUND when the page does not exist', async () => {
      pagesRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.getPermissionsByPage(CHILD_ID, OWNER_ID),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.PAGE_NOT_FOUND));
    });

    it('should throw ACCESS_DENIED when caller has no permission at all', async () => {
      pagesRepo.findOne
        .mockResolvedValueOnce({ id: CHILD_ID, userId: OWNER_ID }) // lookup trong getPermissionsByPage
        .mockResolvedValueOnce({ path: `/${CHILD_ID}` }); // lookup trong resolvePermissionOptimized
      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        { id: CHILD_ID, ownerId: OWNER_ID, permType: null },
      ]);

      await expect(
        service.getPermissionsByPage(CHILD_ID, OTHER_USER_ID),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should return the owner id and every explicit share when caller has access', async () => {
      pagesRepo.findOne
        .mockResolvedValueOnce({ id: CHILD_ID, userId: OWNER_ID })
        .mockResolvedValueOnce({ path: `/${CHILD_ID}` });
      const qb = pagesRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([
        { id: CHILD_ID, ownerId: OWNER_ID, permType: null },
      ]);
      permissionsRepo.find.mockResolvedValueOnce([
        { pageId: CHILD_ID, userId: OTHER_USER_ID, type: PermissionType.View },
      ]);

      const result = await service.getPermissionsByPage(CHILD_ID, OWNER_ID);

      expect(result).toEqual({
        ownerId: OWNER_ID,
        shares: [{ userId: OTHER_USER_ID, type: PermissionType.View }],
      });
    });
  });
});
