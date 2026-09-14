import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { NOTE_MESSAGE_PATTERN } from '@slack/constants';
import { PagesService } from './services/pages.service';
import { BlocksService } from './services/blocks.service';
import { PermissionsService } from './services/permissions.service';
import { DatabaseService } from './services/database.service';
import { CreatePageDto } from './dto/create-page.dto';
import { QueryPagesDto } from './dto/query-pages.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { DeletePageDto } from './dto/delete-page.dto';
import { CreateBlockDto } from './dto/create-block.dto';
import { UpdateBlockDto } from './dto/update-block.dto';
import { DeleteBlockDto } from './dto/delete-block.dto';
import { GetBlocksByPageDto } from './dto/get-blocks-by-page.dto';
import { GetBlockByIdDto } from './dto/get-block-by-id.dto';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { DeletePropertyDto } from './dto/delete-property.dto';
import { GetPropertiesByPageDto } from './dto/get-properties-by-page.dto';
import { CreateViewDto } from './dto/create-view.dto';
import { UpdateViewDto } from './dto/update-view.dto';
import { DeleteViewDto } from './dto/delete-view.dto';
import { GetViewsByPageDto } from './dto/get-views-by-page.dto';
import { SetPropertyValueDto } from './dto/set-property-value.dto';
import { GetPropertyValuesForRowsDto } from './dto/get-property-values-for-rows.dto';
import { PermissionType } from './types/permission.types';

@Controller()
export class NoteController {
  constructor(
    private readonly pagesService: PagesService,
    private readonly blocksService: BlocksService,
    private readonly permissionsService: PermissionsService,
    private readonly databaseService: DatabaseService,
  ) {}

  // ===== Pages =====

  @MessagePattern(NOTE_MESSAGE_PATTERN.CREATE_PAGE)
  async createPage(@Payload() dto: CreatePageDto) {
    return this.pagesService.createPage(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.QUERY_PAGES)
  async queryPages(@Payload() dto: QueryPagesDto) {
    return this.pagesService.queryPages(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.GET_DETAIL_PAGE)
  async getDetailPage(@Payload() data: { callerId: string; pageId: string }) {
    return this.pagesService.getDetailPage(data.callerId, data.pageId);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.UPDATE_PAGE)
  async updatePage(@Payload() dto: UpdatePageDto) {
    return this.pagesService.updatePage(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.DELETE_PAGE)
  async deletePage(@Payload() dto: DeletePageDto) {
    return this.pagesService.deletePage(dto);
  }

  // ===== Blocks =====

  @MessagePattern(NOTE_MESSAGE_PATTERN.CREATE_BLOCK)
  async createBlock(@Payload() dto: CreateBlockDto) {
    return this.blocksService.createBlock(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.UPDATE_BLOCK)
  async updateBlock(@Payload() dto: UpdateBlockDto) {
    return this.blocksService.updateBlock(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.GET_BLOCKS_BY_PAGE_ID)
  async getBlocksByPageId(@Payload() dto: GetBlocksByPageDto) {
    return this.blocksService.getBlocksByPageId(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.GET_BLOCK_BY_ID)
  async getBlockById(@Payload() dto: GetBlockByIdDto) {
    return this.blocksService.getBlockById(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.DELETE_BLOCK)
  async deleteBlock(@Payload() dto: DeleteBlockDto) {
    return this.blocksService.deleteBlock(dto);
  }

  // ===== Permissions =====

  @MessagePattern(NOTE_MESSAGE_PATTERN.TOGGLE_USER_PERMISSION_BY_PAGE)
  async toggleUserPermissionByPage(
    @Payload()
    data: {
      callerId: string;
      pageId: string;
      userId: string;
      type: PermissionType;
    },
  ) {
    return this.permissionsService.toggleUserPermissionByPage(
      data.callerId,
      data.pageId,
      data.userId,
      data.type,
    );
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.GET_USER_PERMISSION_BY_PAGE)
  async getUserPermissionByPage(
    @Payload() data: { pageId: string; userId: string },
  ) {
    return this.permissionsService.getUserPermissionByPage(
      data.pageId,
      data.userId,
    );
  }

  // ===== Database: Properties =====

  @MessagePattern(NOTE_MESSAGE_PATTERN.CREATE_PROPERTY)
  async createProperty(@Payload() dto: CreatePropertyDto) {
    return this.databaseService.createProperty(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.UPDATE_PROPERTY)
  async updateProperty(@Payload() dto: UpdatePropertyDto) {
    return this.databaseService.updateProperty(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.DELETE_PROPERTY)
  async deleteProperty(@Payload() dto: DeletePropertyDto) {
    return this.databaseService.deleteProperty(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.GET_PROPERTIES_BY_PAGE)
  async getPropertiesByPage(@Payload() dto: GetPropertiesByPageDto) {
    return this.databaseService.getPropertiesByPage(dto);
  }

  // ===== Database: Views =====

  @MessagePattern(NOTE_MESSAGE_PATTERN.CREATE_VIEW)
  async createView(@Payload() dto: CreateViewDto) {
    return this.databaseService.createView(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.UPDATE_VIEW)
  async updateView(@Payload() dto: UpdateViewDto) {
    return this.databaseService.updateView(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.DELETE_VIEW)
  async deleteView(@Payload() dto: DeleteViewDto) {
    return this.databaseService.deleteView(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.GET_VIEWS_BY_PAGE)
  async getViewsByPage(@Payload() dto: GetViewsByPageDto) {
    return this.databaseService.getViewsByPage(dto);
  }

  // ===== Database: PropertyValues =====

  @MessagePattern(NOTE_MESSAGE_PATTERN.SET_PROPERTY_VALUE)
  async setPropertyValue(@Payload() dto: SetPropertyValueDto) {
    return this.databaseService.setPropertyValue(dto);
  }

  @MessagePattern(NOTE_MESSAGE_PATTERN.GET_PROPERTY_VALUES_FOR_ROWS)
  async getPropertyValuesForRows(@Payload() dto: GetPropertyValuesForRowsDto) {
    return this.databaseService.getPropertyValuesForRows(dto);
  }
}
