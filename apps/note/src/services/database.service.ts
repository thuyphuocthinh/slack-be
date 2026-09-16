import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { plainToInstance } from 'class-transformer';
import { NOTE_ERROR } from '@slack/constants/errors';
import { PropertiesEntity } from '../entity/properties.entity';
import { ViewsEntity } from '../entity/views.entity';
import { PropertyValuesEntity } from '../entity/property_values.entity';
import { PermissionsService } from './permissions.service';
import { PermissionType } from '../types/permission.types';
import { CreatePropertyDto } from '../dto/create-property.dto';
import { UpdatePropertyDto } from '../dto/update-property.dto';
import { DeletePropertyDto } from '../dto/delete-property.dto';
import { GetPropertiesByPageDto } from '../dto/get-properties-by-page.dto';
import { PropertyResponseDto } from '../dto/property-response.dto';
import { CreateViewDto } from '../dto/create-view.dto';
import { UpdateViewDto } from '../dto/update-view.dto';
import { DeleteViewDto } from '../dto/delete-view.dto';
import { GetViewsByPageDto } from '../dto/get-views-by-page.dto';
import { stripUndefined } from '../utils/object.util';
import { ViewResponseDto } from '../dto/view-response.dto';
import { SetPropertyValueDto } from '../dto/set-property-value.dto';
import { GetPropertyValuesForRowsDto } from '../dto/get-property-values-for-rows.dto';
import { PropertyValueResponseDto } from '../dto/property-value-response.dto';

// Properties/Views thuộc về page DATABASE (cha) -> quyền check ở page cha.
// PropertyValues thuộc về từng ROW (page con) -> quyền check ở ĐÚNG row đó,
// trừ getPropertyValuesForRows (render cả bảng) check 1 lần ở page cha để
// tránh N+1 permission check khi có nhiều row.
@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(
    @InjectRepository(PropertiesEntity)
    private readonly propertiesRepo: Repository<PropertiesEntity>,
    @InjectRepository(ViewsEntity)
    private readonly viewsRepo: Repository<ViewsEntity>,
    @InjectRepository(PropertyValuesEntity)
    private readonly propertyValuesRepo: Repository<PropertyValuesEntity>,
    private readonly permissionsService: PermissionsService,
    private readonly dataSource: DataSource,
  ) {}

  private mapToPropertyResponse(
    property: PropertiesEntity,
  ): PropertyResponseDto {
    return plainToInstance(PropertyResponseDto, property, {
      excludeExtraneousValues: true,
    });
  }

  private mapToViewResponse(view: ViewsEntity): ViewResponseDto {
    return plainToInstance(ViewResponseDto, view, {
      excludeExtraneousValues: true,
    });
  }

  private mapToPropertyValueResponse(
    value: PropertyValuesEntity,
  ): PropertyValueResponseDto {
    return plainToInstance(PropertyValueResponseDto, value, {
      excludeExtraneousValues: true,
    });
  }

  // ===== Properties (cột) — quyền check ở page Database cha =====

  async createProperty(dto: CreatePropertyDto): Promise<PropertyResponseDto> {
    try {
      const { pageId, userId, name, type, options, order } = dto;

      await this.permissionsService.assertPermission(
        pageId,
        userId,
        PermissionType.Edit,
      );

      const property = this.propertiesRepo.create({
        pageId,
        name,
        type,
        options,
        order,
      });
      await this.propertiesRepo.save(property);
      this.logger.debug(`Property created successfully: ${property.id}`);
      return this.mapToPropertyResponse(property);
    } catch (error) {
      this.logger.error(`Error creating property:`, error);
      throw error;
    }
  }

  async updateProperty(dto: UpdatePropertyDto): Promise<PropertyResponseDto> {
    try {
      const { id, userId, ...updateData } = dto;

      const property = await this.propertiesRepo.findOne({ where: { id } });
      if (!property) {
        throw new RpcException(NOTE_ERROR.PROPERTY_NOT_FOUND);
      }

      await this.permissionsService.assertPermission(
        property.pageId,
        userId,
        PermissionType.Edit,
      );

      Object.assign(property, stripUndefined(updateData));
      await this.propertiesRepo.save(property);
      this.logger.debug(`Updated property ${id}`);
      return this.mapToPropertyResponse(property);
    } catch (error) {
      this.logger.error(`Error updating property:`, error);
      throw error;
    }
  }

  // Xóa cột phải cascade xóa hết PropertyValues trỏ tới cột đó — không có FK
  // constraint ở tầng DB (convention microservice trong repo), nên tự xóa tay.
  async deleteProperty(dto: DeletePropertyDto): Promise<{ success: true }> {
    try {
      const { id, userId } = dto;

      const property = await this.propertiesRepo.findOne({ where: { id } });
      if (!property) {
        throw new RpcException(NOTE_ERROR.PROPERTY_NOT_FOUND);
      }

      await this.permissionsService.assertPermission(
        property.pageId,
        userId,
        PermissionType.Edit,
      );

      // Transaction vì đây là "Đa tác vụ" (2 bảng) — không có thì nếu bước 2 lỗi
      // giữa chừng sẽ mất giá trị cột nhưng cột vẫn còn tồn tại (sai cả 2 chiều).
      await this.dataSource.transaction(async (manager) => {
        await manager.softDelete(PropertyValuesEntity, { propertyId: id });
        await manager.softDelete(PropertiesEntity, id);
      });
      this.logger.debug(`Deleted property ${id} (cascade PropertyValues)`);

      return { success: true };
    } catch (error) {
      this.logger.error(`Error deleting property:`, error);
      throw error;
    }
  }

  // View đủ để xem cột — không cần Edit
  async getPropertiesByPage(
    dto: GetPropertiesByPageDto,
  ): Promise<PropertyResponseDto[]> {
    try {
      const { pageId, userId } = dto;

      await this.permissionsService.assertPermission(
        pageId,
        userId,
        PermissionType.View,
      );

      const properties = await this.propertiesRepo.find({
        where: { pageId },
        order: { order: 'ASC' },
      });
      return properties.map((p) => this.mapToPropertyResponse(p));
    } catch (error) {
      this.logger.error(`Error getting properties by page:`, error);
      throw error;
    }
  }

  // ===== Views (Table/Board...) — quyền check ở page Database cha =====

  async createView(dto: CreateViewDto): Promise<ViewResponseDto> {
    try {
      const { pageId, userId, type, name, config } = dto;

      await this.permissionsService.assertPermission(
        pageId,
        userId,
        PermissionType.Edit,
      );

      const view = this.viewsRepo.create({
        pageId,
        type,
        name,
        config: config ?? {},
      });
      await this.viewsRepo.save(view);
      this.logger.debug(`View created successfully: ${view.id}`);
      return this.mapToViewResponse(view);
    } catch (error) {
      this.logger.error(`Error creating view:`, error);
      throw error;
    }
  }

  async updateView(dto: UpdateViewDto): Promise<ViewResponseDto> {
    try {
      const { id, userId, ...updateData } = dto;

      const view = await this.viewsRepo.findOne({ where: { id } });
      if (!view) {
        throw new RpcException(NOTE_ERROR.VIEW_NOT_FOUND);
      }

      await this.permissionsService.assertPermission(
        view.pageId,
        userId,
        PermissionType.Edit,
      );

      Object.assign(view, stripUndefined(updateData));
      await this.viewsRepo.save(view);
      this.logger.debug(`Updated view ${id}`);
      return this.mapToViewResponse(view);
    } catch (error) {
      this.logger.error(`Error updating view:`, error);
      throw error;
    }
  }

  async deleteView(dto: DeleteViewDto): Promise<{ success: true }> {
    try {
      const { id, userId } = dto;

      const view = await this.viewsRepo.findOne({ where: { id } });
      if (!view) {
        throw new RpcException(NOTE_ERROR.VIEW_NOT_FOUND);
      }

      await this.permissionsService.assertPermission(
        view.pageId,
        userId,
        PermissionType.Edit,
      );

      await this.viewsRepo.softDelete(id);
      this.logger.debug(`Deleted view ${id}`);

      return { success: true };
    } catch (error) {
      this.logger.error(`Error deleting view:`, error);
      throw error;
    }
  }

  async getViewsByPage(dto: GetViewsByPageDto): Promise<ViewResponseDto[]> {
    try {
      const { pageId, userId } = dto;

      await this.permissionsService.assertPermission(
        pageId,
        userId,
        PermissionType.View,
      );

      const views = await this.viewsRepo.find({ where: { pageId } });
      return views.map((v) => this.mapToViewResponse(v));
    } catch (error) {
      this.logger.error(`Error getting views by page:`, error);
      throw error;
    }
  }

  // ===== PropertyValues (giá trị từng ô) — quyền check ở ĐÚNG ROW, khác 2 nhóm trên =====

  // Upsert atomic (ON CONFLICT) thay vì find-then-write — tránh hẳn race
  // condition thay vì phải bọc transaction/lock (giống pageDocumentsRepo.upsert
  // ở hocuspocus.gateway.ts).
  async setPropertyValue(
    dto: SetPropertyValueDto,
  ): Promise<PropertyValueResponseDto> {
    try {
      const { pageId, propertyId, value, userId } = dto;

      await this.permissionsService.assertPermission(
        pageId,
        userId,
        PermissionType.Edit,
      );

      await this.propertyValuesRepo.upsert(
        { pageId, propertyId, value: value as Record<string, any> },
        ['pageId', 'propertyId'],
      );

      const result = await this.propertyValuesRepo.findOneOrFail({
        where: { pageId, propertyId },
      });
      this.logger.debug(
        `Set property value for page ${pageId}, property ${propertyId}`,
      );
      return this.mapToPropertyValueResponse(result);
    } catch (error) {
      this.logger.error(`Error setting property value:`, error);
      throw error;
    }
  }

  // Lấy giá trị cho NHIỀU row cùng lúc (render cả bảng Table view) — check quyền
  // đúng 1 LẦN ở page Database cha, không check từng row (tránh N+1).
  async getPropertyValuesForRows(
    dto: GetPropertyValuesForRowsDto,
  ): Promise<PropertyValueResponseDto[]> {
    try {
      const { databasePageId, rowIds, userId } = dto;

      await this.permissionsService.assertPermission(
        databasePageId,
        userId,
        PermissionType.View,
      );

      const values = await this.propertyValuesRepo.find({
        where: { pageId: In(rowIds) },
      });
      return values.map((v) => this.mapToPropertyValueResponse(v));
    } catch (error) {
      this.logger.error(`Error getting property values for rows:`, error);
      throw error;
    }
  }
}
