import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { NOTE_ERROR } from '@slack/constants/errors';
import { DatabaseService } from './database.service';
import { PropertiesEntity } from '../entity/properties.entity';
import { ViewsEntity } from '../entity/views.entity';
import { PropertyValuesEntity } from '../entity/property_values.entity';
import { PermissionsService } from './permissions.service';
import { PermissionType } from '../types/permission.types';
import { PropertyType } from '../types/properties.types';
import { ViewType } from '../types/views.types';

describe('DatabaseService', () => {
  let service: DatabaseService;
  let propertiesRepo: any;
  let viewsRepo: any;
  let propertyValuesRepo: any;
  let permissionsService: any;
  let manager: any;

  const DATABASE_PAGE_ID = 'database-page-1';
  const ROW_ID = 'row-1';
  const PROPERTY_ID = 'property-1';
  const VIEW_ID = 'view-1';
  const EDITOR_ID = 'editor-1';
  const VIEWER_ID = 'viewer-1';

  const deny = () => Promise.reject(new RpcException(NOTE_ERROR.ACCESS_DENIED));
  const allow = () => Promise.resolve(undefined);

  beforeEach(async () => {
    propertiesRepo = {
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve(data)),
      find: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    viewsRepo = {
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve(data)),
      find: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    propertyValuesRepo = {
      upsert: jest.fn(),
      find: jest.fn(),
      findOneOrFail: jest.fn(),
      delete: jest.fn(),
    };

    permissionsService = {
      assertPermission: jest.fn().mockImplementation(allow),
    };

    manager = {
      delete: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn((cb) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        {
          provide: getRepositoryToken(PropertiesEntity),
          useValue: propertiesRepo,
        },
        { provide: getRepositoryToken(ViewsEntity), useValue: viewsRepo },
        {
          provide: getRepositoryToken(PropertyValuesEntity),
          useValue: propertyValuesRepo,
        },
        { provide: PermissionsService, useValue: permissionsService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<DatabaseService>(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createProperty', () => {
    it('should throw ACCESS_DENIED when caller lacks Edit on the database page', async () => {
      permissionsService.assertPermission.mockImplementationOnce(deny);

      await expect(
        service.createProperty({
          pageId: DATABASE_PAGE_ID,
          userId: VIEWER_ID,
          name: 'Status',
          type: PropertyType.Select,
          order: 0,
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));

      expect(propertiesRepo.save).not.toHaveBeenCalled();
    });

    it('should check permission on the database page, not on a row', async () => {
      await service.createProperty({
        pageId: DATABASE_PAGE_ID,
        userId: EDITOR_ID,
        name: 'Status',
        type: PropertyType.Select,
        order: 0,
      } as any);

      expect(permissionsService.assertPermission).toHaveBeenCalledWith(
        DATABASE_PAGE_ID,
        EDITOR_ID,
        PermissionType.Edit,
      );
    });
  });

  describe('updateProperty', () => {
    it('should throw PROPERTY_NOT_FOUND when the property does not exist', async () => {
      propertiesRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updateProperty({
          id: 'missing',
          userId: EDITOR_ID,
          name: 'x',
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.PROPERTY_NOT_FOUND));
    });

    it('should throw ACCESS_DENIED when caller lacks Edit on the database page', async () => {
      propertiesRepo.findOne.mockResolvedValueOnce({
        id: PROPERTY_ID,
        pageId: DATABASE_PAGE_ID,
        name: 'old',
      });
      permissionsService.assertPermission.mockImplementationOnce(deny);

      await expect(
        service.updateProperty({
          id: PROPERTY_ID,
          userId: VIEWER_ID,
          name: 'new',
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should not overwrite a field that was not sent in the request', async () => {
      propertiesRepo.findOne.mockResolvedValueOnce({
        id: PROPERTY_ID,
        pageId: DATABASE_PAGE_ID,
        name: 'Status',
        order: 2,
      });

      const result = await service.updateProperty({
        id: PROPERTY_ID,
        userId: EDITOR_ID,
        name: 'Priority',
      } as any);

      expect(result.name).toBe('Priority');
      expect(result.order).toBe(2);
    });
  });

  describe('deleteProperty', () => {
    it('should throw PROPERTY_NOT_FOUND when the property does not exist', async () => {
      propertiesRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.deleteProperty({ id: 'missing', userId: EDITOR_ID }),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.PROPERTY_NOT_FOUND));
    });

    it('should throw ACCESS_DENIED when caller lacks Edit on the database page', async () => {
      propertiesRepo.findOne.mockResolvedValueOnce({
        id: PROPERTY_ID,
        pageId: DATABASE_PAGE_ID,
      });
      permissionsService.assertPermission.mockImplementationOnce(deny);

      await expect(
        service.deleteProperty({ id: PROPERTY_ID, userId: VIEWER_ID }),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should cascade-delete PropertyValues and the property itself inside one transaction', async () => {
      propertiesRepo.findOne.mockResolvedValueOnce({
        id: PROPERTY_ID,
        pageId: DATABASE_PAGE_ID,
      });

      await service.deleteProperty({ id: PROPERTY_ID, userId: EDITOR_ID });

      expect(manager.delete).toHaveBeenCalledWith(PropertyValuesEntity, {
        propertyId: PROPERTY_ID,
      });
      expect(manager.delete).toHaveBeenCalledWith(
        PropertiesEntity,
        PROPERTY_ID,
      );

      const [firstCall, secondCall] = (manager.delete as jest.Mock).mock.calls;
      expect(firstCall[0]).toBe(PropertyValuesEntity); // xóa values TRƯỚC
      expect(secondCall[0]).toBe(PropertiesEntity); // xóa property SAU
    });
  });

  describe('getPropertiesByPage', () => {
    it('should throw ACCESS_DENIED when caller has no permission', async () => {
      permissionsService.assertPermission.mockImplementationOnce(deny);

      await expect(
        service.getPropertiesByPage({
          pageId: DATABASE_PAGE_ID,
          userId: VIEWER_ID,
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should only require View permission (not Edit) to list properties', async () => {
      propertiesRepo.find.mockResolvedValueOnce([]);

      await service.getPropertiesByPage({
        pageId: DATABASE_PAGE_ID,
        userId: VIEWER_ID,
      } as any);

      expect(permissionsService.assertPermission).toHaveBeenCalledWith(
        DATABASE_PAGE_ID,
        VIEWER_ID,
        PermissionType.View,
      );
    });

    it('should return properties ordered ascending', async () => {
      propertiesRepo.find.mockResolvedValueOnce([
        { id: 'p1', order: 0 },
        { id: 'p2', order: 1 },
      ]);

      const result = await service.getPropertiesByPage({
        pageId: DATABASE_PAGE_ID,
        userId: EDITOR_ID,
      } as any);

      expect(propertiesRepo.find).toHaveBeenCalledWith({
        where: { pageId: DATABASE_PAGE_ID },
        order: { order: 'ASC' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('createView', () => {
    it('should throw ACCESS_DENIED when caller lacks Edit on the database page', async () => {
      permissionsService.assertPermission.mockImplementationOnce(deny);

      await expect(
        service.createView({
          pageId: DATABASE_PAGE_ID,
          userId: VIEWER_ID,
          type: ViewType.Table,
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should default config to an empty object when not provided', async () => {
      const result = await service.createView({
        pageId: DATABASE_PAGE_ID,
        userId: EDITOR_ID,
        type: ViewType.Board,
      } as any);

      expect(result.config).toEqual({});
    });
  });

  describe('updateView', () => {
    it('should throw VIEW_NOT_FOUND when the view does not exist', async () => {
      viewsRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updateView({
          id: 'missing',
          userId: EDITOR_ID,
          name: 'x',
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.VIEW_NOT_FOUND));
    });

    it('should throw ACCESS_DENIED when caller lacks Edit', async () => {
      viewsRepo.findOne.mockResolvedValueOnce({
        id: VIEW_ID,
        pageId: DATABASE_PAGE_ID,
      });
      permissionsService.assertPermission.mockImplementationOnce(deny);

      await expect(
        service.updateView({
          id: VIEW_ID,
          userId: VIEWER_ID,
          name: 'x',
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });
  });

  describe('deleteView', () => {
    it('should throw VIEW_NOT_FOUND when the view does not exist', async () => {
      viewsRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.deleteView({ id: 'missing', userId: EDITOR_ID }),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.VIEW_NOT_FOUND));
    });

    it('should delete successfully when caller has Edit', async () => {
      viewsRepo.findOne.mockResolvedValueOnce({
        id: VIEW_ID,
        pageId: DATABASE_PAGE_ID,
      });

      await service.deleteView({ id: VIEW_ID, userId: EDITOR_ID });

      expect(viewsRepo.delete).toHaveBeenCalledWith(VIEW_ID);
    });
  });

  describe('getViewsByPage', () => {
    it('should throw ACCESS_DENIED when caller has no permission', async () => {
      permissionsService.assertPermission.mockImplementationOnce(deny);

      await expect(
        service.getViewsByPage({
          pageId: DATABASE_PAGE_ID,
          userId: VIEWER_ID,
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });
  });

  describe('setPropertyValue', () => {
    it('should throw ACCESS_DENIED when caller lacks Edit on the ROW (not the database page)', async () => {
      permissionsService.assertPermission.mockImplementationOnce(deny);

      await expect(
        service.setPropertyValue({
          pageId: ROW_ID,
          propertyId: PROPERTY_ID,
          value: 'Todo',
          userId: VIEWER_ID,
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));

      // Quyền phải check trên ROW_ID (page con), không phải page Database cha
      expect(permissionsService.assertPermission).toHaveBeenCalledWith(
        ROW_ID,
        VIEWER_ID,
        PermissionType.Edit,
      );
    });

    it('should upsert on the (pageId, propertyId) unique key and return the saved value', async () => {
      propertyValuesRepo.findOneOrFail.mockResolvedValueOnce({
        id: 'pv-1',
        pageId: ROW_ID,
        propertyId: PROPERTY_ID,
        value: 'Todo',
      });

      const result = await service.setPropertyValue({
        pageId: ROW_ID,
        propertyId: PROPERTY_ID,
        value: 'Todo',
        userId: EDITOR_ID,
      } as any);

      expect(propertyValuesRepo.upsert).toHaveBeenCalledWith(
        { pageId: ROW_ID, propertyId: PROPERTY_ID, value: 'Todo' },
        ['pageId', 'propertyId'],
      );
      expect(result.value).toBe('Todo');
    });
  });

  describe('getPropertyValuesForRows', () => {
    it('should throw ACCESS_DENIED when caller has no permission on the database page', async () => {
      permissionsService.assertPermission.mockImplementationOnce(deny);

      await expect(
        service.getPropertyValuesForRows({
          databasePageId: DATABASE_PAGE_ID,
          rowIds: [ROW_ID, 'row-2'],
          userId: VIEWER_ID,
        } as any),
      ).rejects.toThrow(new RpcException(NOTE_ERROR.ACCESS_DENIED));
    });

    it('should check permission exactly once on the database page, not per row', async () => {
      propertyValuesRepo.find.mockResolvedValueOnce([]);

      await service.getPropertyValuesForRows({
        databasePageId: DATABASE_PAGE_ID,
        rowIds: ['row-1', 'row-2', 'row-3'],
        userId: VIEWER_ID,
      } as any);

      expect(permissionsService.assertPermission).toHaveBeenCalledTimes(1);
      expect(permissionsService.assertPermission).toHaveBeenCalledWith(
        DATABASE_PAGE_ID,
        VIEWER_ID,
        PermissionType.View,
      );
    });

    it('should return values for all requested rows', async () => {
      propertyValuesRepo.find.mockResolvedValueOnce([
        { id: 'pv-1', pageId: 'row-1', propertyId: PROPERTY_ID, value: 'Todo' },
        { id: 'pv-2', pageId: 'row-2', propertyId: PROPERTY_ID, value: 'Done' },
      ]);

      const result = await service.getPropertyValuesForRows({
        databasePageId: DATABASE_PAGE_ID,
        rowIds: ['row-1', 'row-2'],
        userId: VIEWER_ID,
      } as any);

      expect(result).toHaveLength(2);
    });
  });
});
