import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, NOTE_MESSAGE_PATTERN } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
import {
  CreatePageApiDto,
  QueryPagesApiDto,
  UpdatePageApiDto,
} from './dto/page-api.dto';
import { CreateBlockApiDto, UpdateBlockApiDto } from './dto/block-api.dto';
import { TogglePermissionApiDto } from './dto/permission-api.dto';
import {
  CreatePropertyApiDto,
  UpdatePropertyApiDto,
} from './dto/property-api.dto';
import { CreateViewApiDto, UpdateViewApiDto } from './dto/view-api.dto';
import {
  GetPropertyValuesForRowsApiDto,
  SetPropertyValueApiDto,
} from './dto/property-value-api.dto';

@Injectable()
export class NoteService {
  private readonly logger = new Logger(NoteService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.NOTE_SERVICE)
    private readonly noteClient: ClientProxy,
  ) {}

  private call<T>(
    pattern: string,
    payload: unknown,
    operation: string,
  ): Promise<T> {
    return MicroserviceErrorHandler.handleAsyncCall(
      () => firstValueFrom(this.noteClient.send<T>(pattern, payload)),
      operation,
      'NoteService',
    );
  }

  // ===== Pages =====

  createPage(userId: string, workspaceId: string, dto: CreatePageApiDto) {
    return this.call(
      NOTE_MESSAGE_PATTERN.CREATE_PAGE,
      { ...dto, userId, workspaceId },
      'createPage',
    );
  }

  queryPages(userId: string, workspaceId: string, dto: QueryPagesApiDto) {
    return this.call(
      NOTE_MESSAGE_PATTERN.QUERY_PAGES,
      { ...dto, userId, workspaceId },
      'queryPages',
    );
  }

  getDetailPage(userId: string, pageId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.GET_DETAIL_PAGE,
      { callerId: userId, pageId },
      'getDetailPage',
    );
  }

  updatePage(userId: string, pageId: string, dto: UpdatePageApiDto) {
    return this.call(
      NOTE_MESSAGE_PATTERN.UPDATE_PAGE,
      { ...dto, id: pageId, userId },
      'updatePage',
    );
  }

  deletePage(userId: string, pageId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.DELETE_PAGE,
      { id: pageId, userId },
      'deletePage',
    );
  }

  duplicatePage(userId: string, pageId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.DUPLICATE_PAGE,
      { id: pageId, userId },
      'duplicatePage',
    );
  }

  getTrashedPages(userId: string, workspaceId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.GET_TRASHED_PAGES,
      { workspaceId, userId },
      'getTrashedPages',
    );
  }

  restorePage(userId: string, pageId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.RESTORE_PAGE,
      { id: pageId, userId },
      'restorePage',
    );
  }

  // ===== Blocks =====

  createBlock(userId: string, dto: CreateBlockApiDto) {
    return this.call(
      NOTE_MESSAGE_PATTERN.CREATE_BLOCK,
      { ...dto, userId },
      'createBlock',
    );
  }

  updateBlock(userId: string, blockId: string, dto: UpdateBlockApiDto) {
    return this.call(
      NOTE_MESSAGE_PATTERN.UPDATE_BLOCK,
      { ...dto, id: blockId, userId },
      'updateBlock',
    );
  }

  getBlocksByPageId(userId: string, pageId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.GET_BLOCKS_BY_PAGE_ID,
      { pageId, userId },
      'getBlocksByPageId',
    );
  }

  getBlockById(userId: string, blockId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.GET_BLOCK_BY_ID,
      { id: blockId, userId },
      'getBlockById',
    );
  }

  deleteBlock(userId: string, blockId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.DELETE_BLOCK,
      { id: blockId, userId },
      'deleteBlock',
    );
  }

  // ===== Permissions =====

  togglePermission(
    callerId: string,
    pageId: string,
    dto: TogglePermissionApiDto,
  ) {
    return this.call(
      NOTE_MESSAGE_PATTERN.TOGGLE_USER_PERMISSION_BY_PAGE,
      { callerId, pageId, userId: dto.targetUserId, type: dto.type },
      'togglePermission',
    );
  }

  getMyPermission(userId: string, pageId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.GET_USER_PERMISSION_BY_PAGE,
      { pageId, userId },
      'getMyPermission',
    );
  }

  getPermissionsByPage(userId: string, pageId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.GET_PERMISSIONS_BY_PAGE,
      { pageId, callerId: userId },
      'getPermissionsByPage',
    );
  }

  // ===== Database: Properties =====

  createProperty(userId: string, pageId: string, dto: CreatePropertyApiDto) {
    return this.call(
      NOTE_MESSAGE_PATTERN.CREATE_PROPERTY,
      { ...dto, pageId, userId },
      'createProperty',
    );
  }

  updateProperty(
    userId: string,
    propertyId: string,
    dto: UpdatePropertyApiDto,
  ) {
    return this.call(
      NOTE_MESSAGE_PATTERN.UPDATE_PROPERTY,
      { ...dto, id: propertyId, userId },
      'updateProperty',
    );
  }

  deleteProperty(userId: string, propertyId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.DELETE_PROPERTY,
      { id: propertyId, userId },
      'deleteProperty',
    );
  }

  getPropertiesByPage(userId: string, pageId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.GET_PROPERTIES_BY_PAGE,
      { pageId, userId },
      'getPropertiesByPage',
    );
  }

  // ===== Database: Views =====

  createView(userId: string, pageId: string, dto: CreateViewApiDto) {
    return this.call(
      NOTE_MESSAGE_PATTERN.CREATE_VIEW,
      { ...dto, pageId, userId },
      'createView',
    );
  }

  updateView(userId: string, viewId: string, dto: UpdateViewApiDto) {
    return this.call(
      NOTE_MESSAGE_PATTERN.UPDATE_VIEW,
      { ...dto, id: viewId, userId },
      'updateView',
    );
  }

  deleteView(userId: string, viewId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.DELETE_VIEW,
      { id: viewId, userId },
      'deleteView',
    );
  }

  getViewsByPage(userId: string, pageId: string) {
    return this.call(
      NOTE_MESSAGE_PATTERN.GET_VIEWS_BY_PAGE,
      { pageId, userId },
      'getViewsByPage',
    );
  }

  // ===== Database: PropertyValues =====

  setPropertyValue(
    userId: string,
    pageId: string,
    propertyId: string,
    dto: SetPropertyValueApiDto,
  ) {
    return this.call(
      NOTE_MESSAGE_PATTERN.SET_PROPERTY_VALUE,
      { pageId, propertyId, value: dto.value, userId },
      'setPropertyValue',
    );
  }

  getPropertyValuesForRows(
    userId: string,
    databasePageId: string,
    dto: GetPropertyValuesForRowsApiDto,
  ) {
    return this.call(
      NOTE_MESSAGE_PATTERN.GET_PROPERTY_VALUES_FOR_ROWS,
      { databasePageId, rowIds: dto.rowIds, userId },
      'getPropertyValuesForRows',
    );
  }
}
