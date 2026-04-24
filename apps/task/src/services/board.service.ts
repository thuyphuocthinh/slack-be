import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TaskBoardEntity } from '../entity/task_board.entity';
import { BoardMemberEntity } from '../entity/board_member.entity';
import { CreateBoardDto, UpdateBoardDto } from '../dto/board.dto';
import { RpcException } from '@nestjs/microservices';
import { TASK_ERROR } from '@slack/constants';
import { IBoardMemberResponse, IBoardResponse } from '../type/task.response';
import { TaskCommonService } from './task-common.service';
import { IOffsetResponse } from '@slack/common';
import { QueryBoardDto } from '../dto/board.dto';

@Injectable()
export class BoardService {
  constructor(
    @InjectRepository(TaskBoardEntity)
    private readonly boardRepo: Repository<TaskBoardEntity>,
    @InjectRepository(BoardMemberEntity)
    private readonly boardMemberRepo: Repository<BoardMemberEntity>,
    private readonly commonService: TaskCommonService,
    private readonly dataSource: DataSource,
  ) {}

  async createNewBoard(
    dto: CreateBoardDto,
    requesterId: string,
  ): Promise<IBoardResponse> {
    return await this.dataSource.transaction(async (manager) => {
      const memberId = await this.commonService.checkWorkspaceMembership(
        dto.workspaceId,
        requesterId,
      );

      const board = manager.create(TaskBoardEntity, dto);
      const saved = await manager.save(board);

      // add creator to board as first member
      const boardMember = manager.create(BoardMemberEntity, {
        boardId: saved.id,
        memberId,
      });
      await manager.save(boardMember);

      return this.mapBoardResponse(saved);
    });
  }

  async updateBoardInfo(
    id: string,
    dto: UpdateBoardDto,
    requesterId: string,
  ): Promise<IBoardResponse> {
    return await this.dataSource.transaction(async (manager) => {
      await this.commonService.checkBoardMembership(id, requesterId, manager);

      const board = await manager.findOne(TaskBoardEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!board) throw new RpcException(TASK_ERROR.BOARD_NOT_FOUND);

      Object.assign(board, dto);
      const saved = await manager.save(board);
      return this.mapBoardResponse(saved);
    });
  }

  async deleteBoard(id: string, requesterId: string): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      await this.commonService.checkBoardMembership(id, requesterId, manager);

      const result = await manager.delete(TaskBoardEntity, id);
      if (result.affected === 0)
        throw new RpcException(TASK_ERROR.BOARD_NOT_FOUND);
      return `Board with ID ${id} has been deleted`;
    });
  }

  async getBoardsInWorkspace(
    queryDto: QueryBoardDto,
    requesterUserId: string,
  ): Promise<IOffsetResponse<IBoardResponse[]>> {
    const { workspaceId, page = 1, limit = 20 } = queryDto;
    const skip = (page - 1) * limit;

    const memberId = await this.commonService.getMemberId(
      workspaceId,
      requesterUserId,
    );

    const query = this.boardRepo
      .createQueryBuilder('board')
      .innerJoin(BoardMemberEntity, 'member', 'member.boardId = board.id')
      .where('board.workspaceId = :workspaceId', { workspaceId })
      .andWhere('member.memberId = :memberId', { memberId })
      .orderBy('board.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    const [items, total] = await query.getManyAndCount();

    const responseData = items.map((b) => this.mapBoardResponse(b));

    return {
      data: responseData,
      paging: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    } as unknown as IOffsetResponse<IBoardResponse[]>;
  }

  async getBoardDetails(
    id: string,
    requesterId: string,
  ): Promise<IBoardResponse> {
    await this.commonService.checkBoardMembership(id, requesterId);

    const board = await this.boardRepo.findOneBy({ id });
    if (!board) throw new RpcException(TASK_ERROR.BOARD_NOT_FOUND);
    return this.mapBoardResponse(board);
  }

  async getBoardMembers(
    boardId: string,
    requesterId: string,
  ): Promise<IBoardMemberResponse[]> {
    await this.commonService.checkBoardMembership(boardId, requesterId);

    const members = await this.boardMemberRepo.find({ where: { boardId } });
    return members.map((m) => this.mapBoardMemberResponse(m));
  }

  async addMemberToBoard(
    boardId: string,
    memberId: string,
    requesterId: string,
  ): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      await this.commonService.checkBoardMembership(
        boardId,
        requesterId,
        manager,
      );

      const existing = await manager.findOne(BoardMemberEntity, {
        where: { boardId, memberId },
      });
      if (existing) throw new RpcException(TASK_ERROR.MEMBER_ALREADY_IN_BOARD);

      const boardMember = manager.create(BoardMemberEntity, {
        boardId,
        memberId,
      });
      await manager.save(boardMember);
      return 'Add member to board successfully';
    });
  }

  async removeMemberFromBoard(
    boardId: string,
    memberId: string,
    requesterId: string,
  ): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      await this.commonService.checkBoardMembership(
        boardId,
        requesterId,
        manager,
      );

      const board = await manager.findOne(TaskBoardEntity, {
        where: { id: boardId },
      });
      if (!board) throw new RpcException(TASK_ERROR.BOARD_NOT_FOUND);

      const requesterMemberId = await this.commonService.getMemberId(
        board.workspaceId,
        requesterId,
      );

      // If removing someone else, must be Admin/Owner
      if (requesterMemberId !== memberId) {
        const role = await this.commonService.getMemberRole(
          board.workspaceId,
          requesterId,
        );
        if (role !== 'ADMIN' && role !== 'OWNER') {
          throw new RpcException(TASK_ERROR.NOT_ENOUGH_PERMISSION);
        }
      }

      const result = await manager.delete(BoardMemberEntity, {
        boardId,
        memberId,
      });
      if (result.affected === 0)
        throw new RpcException(TASK_ERROR.MEMBER_NOT_IN_BOARD);
      return 'Remove member from board successfully';
    });
  }

  private mapBoardResponse(board: TaskBoardEntity): IBoardResponse {
    return {
      id: board.id,
      workspaceId: board.workspaceId,
      name: board.name,
      backgroundUrl: board.backgroundUrl,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
    };
  }

  private mapBoardMemberResponse(
    member: BoardMemberEntity,
  ): IBoardMemberResponse {
    return {
      id: member.id,
      memberId: member.memberId,
    };
  }
}
