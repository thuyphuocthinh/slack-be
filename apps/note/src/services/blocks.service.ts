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

      // field không gửi sẽ không tồn tại như key trên DTO -> Object.assign tự bỏ qua,
      // không đè mất giá trị cũ (khớp pattern pages.service.ts:updatePage)
      Object.assign(block, updateData);

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
  async deleteBlock(deleteBlockDto: DeleteBlockDto): Promise<void> {
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

      await this.blocksRepo.delete(id);
      this.logger.debug(`Deleted block ${id}`);
    } catch (error) {
      this.logger.error(`Error deleting block:`, error);
      throw error;
    }
  }
}
