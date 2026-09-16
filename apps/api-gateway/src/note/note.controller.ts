import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type JwtUser } from '@slack/common';
import { NoteService } from './note.service';
import {
  CreatePageApiDto,
  QueryPagesApiDto,
  UpdatePageApiDto,
  MovePageApiDto,
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

@ApiTags('Note')
@ApiBearerAuth()
@Controller()
export class NoteController {
  constructor(private readonly noteService: NoteService) {}

  // ===== Pages =====

  @Post('workspaces/:workspaceId/notes/pages')
  createPage(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: CreatePageApiDto,
  ) {
    return this.noteService.createPage(user.sub, workspaceId, dto);
  }

  @Get('workspaces/:workspaceId/notes/pages')
  queryPages(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Query() query: QueryPagesApiDto,
  ) {
    return this.noteService.queryPages(user.sub, workspaceId, query);
  }

  @Get('notes/pages/:pageId')
  getDetailPage(@Param('pageId') pageId: string, @CurrentUser() user: JwtUser) {
    return this.noteService.getDetailPage(user.sub, pageId);
  }

  @Patch('notes/pages/:pageId')
  updatePage(
    @Param('pageId') pageId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdatePageApiDto,
  ) {
    return this.noteService.updatePage(user.sub, pageId, dto);
  }

  @Delete('notes/pages/:pageId')
  deletePage(@Param('pageId') pageId: string, @CurrentUser() user: JwtUser) {
    return this.noteService.deletePage(user.sub, pageId);
  }

  @Post('notes/pages/:pageId/duplicate')
  duplicatePage(@Param('pageId') pageId: string, @CurrentUser() user: JwtUser) {
    return this.noteService.duplicatePage(user.sub, pageId);
  }

  @Patch('notes/pages/:pageId/move')
  movePage(
    @Param('pageId') pageId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: MovePageApiDto,
  ) {
    return this.noteService.movePage(user.sub, pageId, dto);
  }

  @Get('workspaces/:workspaceId/notes/trash')
  getTrashedPages(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.noteService.getTrashedPages(user.sub, workspaceId);
  }

  @Post('notes/pages/:pageId/restore')
  restorePage(@Param('pageId') pageId: string, @CurrentUser() user: JwtUser) {
    return this.noteService.restorePage(user.sub, pageId);
  }

  // ===== Blocks =====

  @Post('notes/blocks')
  createBlock(@CurrentUser() user: JwtUser, @Body() dto: CreateBlockApiDto) {
    return this.noteService.createBlock(user.sub, dto);
  }

  @Patch('notes/blocks/:blockId')
  updateBlock(
    @Param('blockId') blockId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateBlockApiDto,
  ) {
    return this.noteService.updateBlock(user.sub, blockId, dto);
  }

  @Get('notes/pages/:pageId/blocks')
  getBlocksByPageId(
    @Param('pageId') pageId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.noteService.getBlocksByPageId(user.sub, pageId);
  }

  @Get('notes/blocks/:blockId')
  getBlockById(
    @Param('blockId') blockId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.noteService.getBlockById(user.sub, blockId);
  }

  @Delete('notes/blocks/:blockId')
  deleteBlock(@Param('blockId') blockId: string, @CurrentUser() user: JwtUser) {
    return this.noteService.deleteBlock(user.sub, blockId);
  }

  // ===== Permissions =====

  @Post('notes/pages/:pageId/permissions')
  togglePermission(
    @Param('pageId') pageId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: TogglePermissionApiDto,
  ) {
    return this.noteService.togglePermission(user.sub, pageId, dto);
  }

  @Get('notes/pages/:pageId/permissions/me')
  getMyPermission(
    @Param('pageId') pageId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.noteService.getMyPermission(user.sub, pageId);
  }

  @Get('notes/pages/:pageId/permissions')
  getPermissionsByPage(
    @Param('pageId') pageId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.noteService.getPermissionsByPage(user.sub, pageId);
  }

  // ===== Database: Properties =====

  @Post('notes/pages/:pageId/properties')
  createProperty(
    @Param('pageId') pageId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: CreatePropertyApiDto,
  ) {
    return this.noteService.createProperty(user.sub, pageId, dto);
  }

  @Patch('notes/properties/:propertyId')
  updateProperty(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdatePropertyApiDto,
  ) {
    return this.noteService.updateProperty(user.sub, propertyId, dto);
  }

  @Delete('notes/properties/:propertyId')
  deleteProperty(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.noteService.deleteProperty(user.sub, propertyId);
  }

  @Get('notes/pages/:pageId/properties')
  getPropertiesByPage(
    @Param('pageId') pageId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.noteService.getPropertiesByPage(user.sub, pageId);
  }

  // ===== Database: Views =====

  @Post('notes/pages/:pageId/views')
  createView(
    @Param('pageId') pageId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateViewApiDto,
  ) {
    return this.noteService.createView(user.sub, pageId, dto);
  }

  @Patch('notes/views/:viewId')
  updateView(
    @Param('viewId') viewId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateViewApiDto,
  ) {
    return this.noteService.updateView(user.sub, viewId, dto);
  }

  @Delete('notes/views/:viewId')
  deleteView(@Param('viewId') viewId: string, @CurrentUser() user: JwtUser) {
    return this.noteService.deleteView(user.sub, viewId);
  }

  @Get('notes/pages/:pageId/views')
  getViewsByPage(
    @Param('pageId') pageId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.noteService.getViewsByPage(user.sub, pageId);
  }

  // ===== Database: PropertyValues =====

  @Put('notes/pages/:pageId/property-values/:propertyId')
  setPropertyValue(
    @Param('pageId') pageId: string,
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: SetPropertyValueApiDto,
  ) {
    return this.noteService.setPropertyValue(user.sub, pageId, propertyId, dto);
  }

  @Get('notes/pages/:databasePageId/property-values')
  getPropertyValuesForRows(
    @Param('databasePageId') databasePageId: string,
    @CurrentUser() user: JwtUser,
    @Query() query: GetPropertyValuesForRowsApiDto,
  ) {
    return this.noteService.getPropertyValuesForRows(
      user.sub,
      databasePageId,
      query,
    );
  }
}
