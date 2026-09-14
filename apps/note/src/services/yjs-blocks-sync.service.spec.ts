import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { YjsBlocksSyncService } from './yjs-blocks-sync.service';
import { BlocksEntity } from '../entity/blocks.entity';
import { BlockType } from '../types/blocks.types';

// Mock TiptapTransformer at module level
jest.mock('@hocuspocus/transformer', () => ({
  TiptapTransformer: {
    fromYdoc: jest.fn(),
  },
}));

import { TiptapTransformer } from '@hocuspocus/transformer';
const mockFromYdoc = TiptapTransformer.fromYdoc as jest.Mock;

describe('YjsBlocksSyncService', () => {
  let service: YjsBlocksSyncService;
  let mockManager: any;
  let dataSource: jest.Mocked<DataSource>;

  // blocksRepo.create() phải trả entity thật (có id, createdAt, v.v.)
  // để match đúng với mapToBlockResponse → plainToInstance
  const createMockEntity = (data: Partial<BlocksEntity>): BlocksEntity => {
    return {
      id: 'mock-uuid',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      deletedAt: null as any,
      ...data,
    } as BlocksEntity;
  };

  beforeEach(async () => {
    mockManager = {
      delete: jest.fn(),
      save: jest.fn().mockImplementation((_entity, blocks) => blocks),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YjsBlocksSyncService,
        {
          provide: getRepositoryToken(BlocksEntity),
          useValue: {
            create: jest.fn((data) => createMockEntity(data)),
          },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((cb) => cb(mockManager)),
          },
        },
      ],
    }).compile();

    service = module.get<YjsBlocksSyncService>(YjsBlocksSyncService);
    dataSource = module.get(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('syncFromYdoc', () => {
    const mockDoc = {} as any;

    it('should parse simple paragraph and return BlockResponseDto[]', async () => {
      mockFromYdoc.mockReturnValue({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      });

      const result = await service.syncFromYdoc('page-1', mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        pageId: 'page-1',
        type: BlockType.Text,
        order: 0,
      });
      // Phải trả BlockResponseDto, có id, createdAt, updatedAt
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('createdAt');
      expect(result[0]).toHaveProperty('updatedAt');
    });

    it('should parse multiple block types with correct order', async () => {
      mockFromYdoc.mockReturnValue({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Text' }] },
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Title' }],
          },
          { type: 'horizontalRule' },
          { type: 'codeBlock', content: [{ type: 'text', text: 'code()' }] },
        ],
      });

      const result = await service.syncFromYdoc('page-1', mockDoc);

      expect(result).toHaveLength(4);
      expect(result[0].type).toBe(BlockType.Text);
      expect(result[0].order).toBe(0);
      expect(result[1].type).toBe(BlockType.Heading);
      expect(result[1].order).toBe(1);
      expect(result[2].type).toBe(BlockType.Divider);
      expect(result[2].order).toBe(2);
      expect(result[3].type).toBe(BlockType.Code);
      expect(result[3].order).toBe(3);
    });

    it('should preserve heading attrs in content', async () => {
      mockFromYdoc.mockReturnValue({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Section' }],
          },
        ],
      });

      const result = await service.syncFromYdoc('page-1', mockDoc);

      expect(result[0].content).toEqual({
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Section' }],
      });
    });

    it('should flatten bulletList → single block with nested content', async () => {
      mockFromYdoc.mockReturnValue({
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Item 1' }],
                  },
                ],
              },
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Item 2' }],
                  },
                ],
              },
            ],
          },
        ],
      });

      const result = await service.syncFromYdoc('page-1', mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(BlockType.Bullet);
      // listItems nested trong content JSONB
      expect((result[0].content as any).content).toHaveLength(2);
    });

    it('should skip unknown nodes without gaps in order', async () => {
      mockFromYdoc.mockReturnValue({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
          { type: 'customWidget', attrs: { foo: 'bar' } },
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Second' }],
          },
        ],
      });

      const result = await service.syncFromYdoc('page-1', mockDoc);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe(BlockType.Text);
      expect(result[0].order).toBe(0);
      expect(result[1].type).toBe(BlockType.Heading);
      expect(result[1].order).toBe(1); // no gap
    });

    it('should return empty array for empty document', async () => {
      mockFromYdoc.mockReturnValue({ type: 'doc', content: [] });

      const result = await service.syncFromYdoc('page-1', mockDoc);

      expect(result).toEqual([]);
      expect(mockManager.delete).toHaveBeenCalledWith(BlocksEntity, {
        pageId: 'page-1',
      });
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('should return empty array for document with no content key', async () => {
      mockFromYdoc.mockReturnValue({ type: 'doc' });

      const result = await service.syncFromYdoc('page-1', mockDoc);

      expect(result).toEqual([]);
    });

    it('should call transaction with delete then save', async () => {
      mockFromYdoc.mockReturnValue({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Test' }] },
        ],
      });

      await service.syncFromYdoc('page-1', mockDoc);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(mockManager.delete).toHaveBeenCalledWith(BlocksEntity, {
        pageId: 'page-1',
      });
      expect(mockManager.save).toHaveBeenCalledWith(
        BlocksEntity,
        expect.arrayContaining([
          expect.objectContaining({ pageId: 'page-1', type: BlockType.Text }),
        ]),
      );
    });

    it('should map video node to Media type', async () => {
      mockFromYdoc.mockReturnValue({
        type: 'doc',
        content: [
          { type: 'video', attrs: { src: 'https://example.com/video.mp4' } },
        ],
      });

      const result = await service.syncFromYdoc('page-1', mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(BlockType.Media);
      expect(result[0].content).toEqual({
        attrs: { src: 'https://example.com/video.mp4' },
      });
    });

    it('should throw and propagate error if TiptapTransformer fails', async () => {
      mockFromYdoc.mockImplementation(() => {
        throw new Error('Invalid Yjs document');
      });

      await expect(service.syncFromYdoc('page-1', mockDoc)).rejects.toThrow(
        'Invalid Yjs document',
      );
    });
  });
});
