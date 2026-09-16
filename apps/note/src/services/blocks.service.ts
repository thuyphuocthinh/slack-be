import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlocksEntity } from '../entity/blocks.entity';
import { plainToInstance } from 'class-transformer';
import { BlockResponseDto } from '../dto/block-response.dto';
import { CreateBlockDto } from '../dto/create-block.dto';
import { UpdateBlockDto } from '../dto/update-block.dto';
import { DeleteBlockDto } from '../dto/delete-block.dto';
import { GetBlocksByPageDto } from '../dto/get-blocks-by-page.dto';
import { GetBlockByIdDto } from '../dto/get-block-by-id.dto';
import { RpcException } from '@nestjs/microservices';
import { NOTE_ERROR } from '@slack/constants/errors';
import { PermissionsService } from './permissions.service';
import { PermissionType } from '../types/permission.types';
import { extractPlainText } from '../utils/prosemirror.util';
import { stripUndefined } from '../utils/object.util';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class BlocksService {
  private readonly logger = new Logger(BlocksService.name);

  constructor(
    @InjectRepository(BlocksEntity)
    private readonly blocksRepo: Repository<BlocksEntity>,
    private readonly permissionsService: PermissionsService,
  ) {}

  private mapToBlockResponse(block: BlocksEntity): BlockResponseDto {
    return plainToInstance(BlockResponseDto, block, {
      excludeExtraneousValues: true,
    });
  }

  // create block — chỉ cần Edit ở page cha, không cần transaction/lock vì đây
  // là "content" (giống best_practives.md), không phải tiền/số lượng/quyền hạn.
  async createBlock(createBlockDto: CreateBlockDto): Promise<BlockResponseDto> {
    try {
      const { pageId, userId, type, content, order, parentId } = createBlockDto;

      await this.permissionsService.assertPermission(
        pageId,
        userId,
        PermissionType.Edit,
      );

      const block = this.blocksRepo.create({
        pageId,
        type,
        content,
        contentText: extractPlainText(content),
        order,
        parentId,
      });
      await this.blocksRepo.save(block);
      this.logger.debug(`Block created successfully: ${block.id}`);
      return this.mapToBlockResponse(block);
    } catch (error) {
      this.logger.error(`Error creating block:`, error);
      throw error;
    }
  }

  // update block
  async updateBlock(updateBlockDto: UpdateBlockDto): Promise<BlockResponseDto> {
    try {
      const { id, userId, ...updateData } = updateBlockDto;

      const block = await this.blocksRepo.findOne({ where: { id } });
      if (!block) {
        throw new RpcException(NOTE_ERROR.BLOCK_NOT_FOUND);
      }

      await this.permissionsService.assertPermission(
        block.pageId,
        userId,
        PermissionType.Edit,
      );

      // stripUndefined: ValidationPipe tạo DTO có sẵn mọi field = undefined dù
      // không gửi lên -> Object.assign thẳng sẽ đè mất giá trị cũ trong entity.
      Object.assign(block, stripUndefined(updateData));

      // content đổi -> contentText phải tính lại theo, nếu không search sẽ lệch
      // khỏi nội dung thật.
      if (updateData.content !== undefined) {
        block.contentText = extractPlainText(block.content);
      }

      await this.blocksRepo.save(block);
      this.logger.debug(`Updated block ${id}`);
      return this.mapToBlockResponse(block);
    } catch (error) {
      this.logger.error(`Error updating block:`, error);
      throw error;
    }
  }

  // get blocks by page id — chỉ cần View là đủ để xem
  async getBlocksByPageId(
    query: GetBlocksByPageDto,
  ): Promise<BlockResponseDto[]> {
    try {
      const { pageId, userId } = query;

      await this.permissionsService.assertPermission(
        pageId,
        userId,
        PermissionType.View,
      );

      const blocks = await this.blocksRepo.find({
        where: { pageId },
        order: { order: 'ASC' },
      });
      return blocks.map((block) => this.mapToBlockResponse(block));
    } catch (error) {
      this.logger.error(`Error getting blocks by page id:`, error);
      throw error;
    }
  }

  // get block by id
  async getBlockById(query: GetBlockByIdDto): Promise<BlockResponseDto> {
    try {
      const { id, userId } = query;

      const block = await this.blocksRepo.findOne({ where: { id } });
      if (!block) {
        throw new RpcException(NOTE_ERROR.BLOCK_NOT_FOUND);
      }

      await this.permissionsService.assertPermission(
        block.pageId,
        userId,
        PermissionType.View,
      );

      return this.mapToBlockResponse(block);
    } catch (error) {
      this.logger.error(`Error getting block by id:`, error);
      throw error;
    }
  }

  // delete block
  async deleteBlock(
    deleteBlockDto: DeleteBlockDto,
  ): Promise<{ success: true }> {
    try {
      const { id, userId } = deleteBlockDto;

      const block = await this.blocksRepo.findOne({ where: { id } });
      if (!block) {
        throw new RpcException(NOTE_ERROR.BLOCK_NOT_FOUND);
      }

      await this.permissionsService.assertPermission(
        block.pageId,
        userId,
        PermissionType.Edit,
      );

      await this.blocksRepo.softDelete(id);
      this.logger.debug(`Deleted block ${id}`);

      return { success: true };
    } catch (error) {
      this.logger.error(`Error deleting block:`, error);
      throw error;
    }
  }

  // Dùng khi PagesService.duplicatePage() nhân bản 1 page — copy toàn bộ block
  // sang page mới, giữ order + cấu trúc lồng nhau (parentId trỏ giữa các block
  // với nhau) bằng id map cũ->mới. Không tự check permission — caller
  // (PagesService.duplicatePage) đã assertPermission View trên page gốc rồi.
  async duplicateForPage(oldPageId: string, newPageId: string): Promise<void> {
    const blocks = await this.blocksRepo.find({
      where: { pageId: oldPageId },
      order: { order: 'ASC' },
    });
    if (blocks.length === 0) return;

    const idMap = new Map<string, string>();
    blocks.forEach((b) => idMap.set(b.id, uuidv4()));

    const cloned = blocks.map((b) =>
      this.blocksRepo.create({
        id: idMap.get(b.id),
        pageId: newPageId,
        type: b.type,
        content: b.content,
        contentText: b.contentText,
        order: b.order,
        parentId: b.parentId ? idMap.get(b.parentId) : undefined,
      }),
    );
    await this.blocksRepo.save(cloned);
  }
}
