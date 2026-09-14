import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { NOTE_ERROR } from '@slack/constants/errors';
import { BlocksService } from './blocks.service';
import { BlocksEntity } from '../entity/blocks.entity';
import { PermissionsService } from './permissions.service';
import { PermissionType } from '../types/permission.types';
import { BlockType } from '../types/blocks.types';

describe('BlocksService', () => {
  let service: BlocksService;
  let blocksRepo: any;
  let permissionsService: any;

  const PAGE_ID = 'page-1';
  const BLOCK_ID = 'block-1';
  const EDITOR_ID = 'editor-1';
  const VIEWER_ID = 'viewer-1';
  const STRANGER_ID = 'stranger-1';

  beforeEach(async () => {
    blocksRepo = {
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve(data)),
      find: jest.fn(),
      findOne: jest.fn(),
      softDelete: jest.fn(),
    };

    permissionsService = {
      getUserPermissionByPage: jest.fn(),
    };
    // assertPermission ủy quyền qua getUserPermissionByPage đã mock ở trên,
    // để các test case hiện có không cần sửa gì thêm.
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlocksService,
        { provide: getRepositoryToken(BlocksEntity), useValue: blocksRepo },
        { provide: PermissionsService, useValue: permissionsService },
      ],
    }).compile();

    service = module.get<BlocksService>(BlocksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createBlock', () => {
    it('should throw ACCESS_DENIED when caller only has View permission', async () => {
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.View,
      );

      await expect(
        service.createBlock({
          pageId: PAGE_ID,
          userId: VIEWER_ID,
          type: BlockType.Text,
          content: { text: 'hello' },
          order: 0,
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));

      expect(blocksRepo.save).not.toHaveBeenCalled();
    });

    it('should create the block when caller has Edit permission', async () => {
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.Edit,
      );

      const result = await service.createBlock({
        pageId: PAGE_ID,
        userId: EDITOR_ID,
        type: BlockType.Text,
        content: { text: 'hello' },
        order: 0,
      } as any);

      expect(blocksRepo.save).toHaveBeenCalled();
      expect(result.content).toEqual({ text: 'hello' });
    });
  });

  describe('updateBlock', () => {
    it('should throw BLOCK_NOT_FOUND when the block does not exist', async () => {
      blocksRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updateBlock({
          id: 'missing',
          userId: EDITOR_ID,
          content: { text: 'x' },
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.BLOCK_NOT_FOUND));
    });

    it('should throw ACCESS_DENIED when caller only has View permission on the parent page', async () => {
      blocksRepo.findOne.mockResolvedValueOnce({
        id: BLOCK_ID,
        pageId: PAGE_ID,
        content: { text: 'old' },
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.View,
      );

      await expect(
        service.updateBlock({
          id: BLOCK_ID,
          userId: VIEWER_ID,
          content: { text: 'new' },
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should not overwrite a field that was not sent in the request', async () => {
      blocksRepo.findOne.mockResolvedValueOnce({
        id: BLOCK_ID,
        pageId: PAGE_ID,
        content: { text: 'old' },
        order: 3,
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.Edit,
      );

      // order không gửi trong request -> phải giữ nguyên giá trị cũ
      const result = await service.updateBlock({
        id: BLOCK_ID,
        userId: EDITOR_ID,
        content: { text: 'new' },
      } as any);

      expect(result.content).toEqual({ text: 'new' });
      expect(result.order).toBe(3);
    });

    it('should not leak id/userId from the DTO onto the saved entity', async () => {
      blocksRepo.findOne.mockResolvedValueOnce({
        id: BLOCK_ID,
        pageId: PAGE_ID,
        content: { text: 'old' },
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.Edit,
      );

      await service.updateBlock({
        id: BLOCK_ID,
        userId: EDITOR_ID,
        content: { text: 'new' },
      } as any);

      const saved = (blocksRepo.save as jest.Mock).mock.calls[0][0];
      expect(saved.id).toBe(BLOCK_ID); // vẫn đúng id gốc, không bị field lạ ghi đè
      expect(saved).not.toHaveProperty('userId'); // BlocksEntity không có cột này
    });
  });

  describe('getBlocksByPageId', () => {
    it('should throw ACCESS_DENIED when caller has no permission at all', async () => {
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(null);

      await expect(
        service.getBlocksByPageId({
          pageId: PAGE_ID,
          userId: STRANGER_ID,
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should return blocks ordered ascending when caller only has View permission', async () => {
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.View,
      );
      blocksRepo.find.mockResolvedValueOnce([
        { id: 'b1', pageId: PAGE_ID, order: 0 },
        { id: 'b2', pageId: PAGE_ID, order: 1 },
      ]);

      const result = await service.getBlocksByPageId({
        pageId: PAGE_ID,
        userId: VIEWER_ID,
      } as any);

      expect(blocksRepo.find).toHaveBeenCalledWith({
        where: { pageId: PAGE_ID },
        order: { order: 'ASC' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('getBlockById', () => {
    it('should throw BLOCK_NOT_FOUND when the block does not exist', async () => {
      blocksRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.getBlockById({ id: 'missing', userId: VIEWER_ID } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.BLOCK_NOT_FOUND));
    });

    it('should throw ACCESS_DENIED when caller has no permission on the parent page', async () => {
      blocksRepo.findOne.mockResolvedValueOnce({
        id: BLOCK_ID,
        pageId: PAGE_ID,
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(null);

      await expect(
        service.getBlockById({ id: BLOCK_ID, userId: STRANGER_ID } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should return the block when caller has View permission', async () => {
      blocksRepo.findOne.mockResolvedValueOnce({
        id: BLOCK_ID,
        pageId: PAGE_ID,
        content: { text: 'hi' },
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.View,
      );

      const result = await service.getBlockById({
        id: BLOCK_ID,
        userId: VIEWER_ID,
      } as any);

      expect(result.content).toEqual({ text: 'hi' });
    });
  });

  describe('deleteBlock', () => {
    it('should throw BLOCK_NOT_FOUND when the block does not exist', async () => {
      blocksRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.deleteBlock({ id: 'missing', userId: EDITOR_ID }),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.BLOCK_NOT_FOUND));
    });

    it('should throw ACCESS_DENIED when caller only has View permission', async () => {
      blocksRepo.findOne.mockResolvedValueOnce({
        id: BLOCK_ID,
        pageId: PAGE_ID,
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.View,
      );

      await expect(
        service.deleteBlock({ id: BLOCK_ID, userId: VIEWER_ID }),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should delete successfully when caller has Edit permission', async () => {
      blocksRepo.findOne.mockResolvedValueOnce({
        id: BLOCK_ID,
        pageId: PAGE_ID,
      });
      permissionsService.getUserPermissionByPage.mockResolvedValueOnce(
        PermissionType.Edit,
      );

      await service.deleteBlock({ id: BLOCK_ID, userId: EDITOR_ID });

      expect(blocksRepo.softDelete).toHaveBeenCalledWith(BLOCK_ID);
    });
  });
});
