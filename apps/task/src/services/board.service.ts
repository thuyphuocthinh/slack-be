import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TaskBoardEntity } from '../entity/task_board.entity';
import { BoardMemberEntity } from '../entity/board_member.entity';
import { CreateBoardDto, UpdateBoardDto } from '../dto/board.dto';
import { RpcException } from '@nestjs/microservices';
import { DATABASE_ERROR, TASK_ERROR } from '@slack/constants';
import { IBoardMemberResponse, IBoardResponse } from '../type/task.response';
import { TaskCommonService } from './task-common.service';
import { IOffsetResponse } from '@slack/common';
import { QueryBoardDto } from '../dto/board.dto';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { OptimisticLockVersionMismatchError } from 'typeorm';

@Injectable()
export class BoardService {
  private readonly logger = new Logger(BoardService.name);

  constructor(
    @InjectRepository(TaskBoardEntity)
    private readonly boardRepo: Repository<TaskBoardEntity>,
    @InjectRepository(BoardMemberEntity)
    private readonly boardMemberRepo: Repository<BoardMemberEntity>,
    private readonly commonService: TaskCommonService,
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
  ) {}

  async createNewBoard(
    dto: CreateBoardDto,
    requesterId: string,
  ): Promise<IBoardResponse> {
    const { result, memberId } = await this.dataSource.transaction(
      async (manager) => {
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

        const result = this.mapBoardResponse(saved);

        return { result, memberId };
      },
    );

    await this.cachedService.invalidateList(
      CACHE.TASK.TRACKERS.BOARD_LIST_VERSION(dto.workspaceId, memberId),
    );

    // Invalidate individual board membership cache
    this.cachedService.del(
      CACHE.TASK.KEYS.BOARD_MEMBERSHIP(result.id, memberId),
    );

    return result;
  }

  async updateBoardInfo(
    id: string,
    dto: UpdateBoardDto,
    requesterId: string,
  ): Promise<IBoardResponse> {
    const { result, members, workspaceId } = await this.dataSource.transaction(
      async (manager) => {
        await this.commonService.checkBoardMembership(id, requesterId, manager);

        const board = await manager.findOne(TaskBoardEntity, {
          where: { id },
        });
        if (!board) throw new RpcException(TASK_ERROR.BOARD_NOT_FOUND);

        Object.assign(board, dto);
        try {
          const saved = await manager.save(board);
          const result = this.mapBoardResponse(saved);

          const members = await manager.find(BoardMemberEntity, {
            where: { boardId: id },
          });

          return { result, members, workspaceId: board.workspaceId };
        } catch (error) {
          if (error instanceof OptimisticLockVersionMismatchError) {
            throw new RpcException(DATABASE_ERROR.OPTIMISTIC_LOCK_CONFLICT);
          }
          throw error;
        }
      },
    );

    const trackerKeys = members.map((m) =>
      CACHE.TASK.TRACKERS.BOARD_LIST_VERSION(workspaceId, m.memberId),
    );
    await this.cachedService.invalidateListBulk(trackerKeys);

    // Invalidate individual board membership cache for all members
    await Promise.all(
      members.map((m) =>
        this.cachedService.del(
          CACHE.TASK.KEYS.BOARD_MEMBERSHIP(result.id, m.memberId),
        ),
      ),
    );

    return result;
  }

  async deleteBoard(id: string, requesterId: string): Promise<string> {
    const { trackerKeys, memberIds } = await this.dataSource.transaction(
      async (manager) => {
        await this.commonService.checkBoardMembership(id, requesterId, manager);

        const boardId = id;
        const workspaceId = (
          await manager.findOne(TaskBoardEntity, {
            where: { id: boardId },
            select: ['workspaceId'],
          })
        )?.workspaceId;
        if (!workspaceId) throw new RpcException(TASK_ERROR.BOARD_NOT_FOUND);

        const members = await manager.find(BoardMemberEntity, {
          where: { boardId },
        });
        const trackerKeys = members.map((m) =>
          CACHE.TASK.TRACKERS.BOARD_LIST_VERSION(workspaceId, m.memberId),
        );
        const memberIds = members.map((m) => m.memberId);

        const result = await manager.delete(TaskBoardEntity, id);
        if (result.affected === 0)
          throw new RpcException(TASK_ERROR.BOARD_NOT_FOUND);

        return { trackerKeys, memberIds };
      },
    );

    await this.cachedService.invalidateListBulk(trackerKeys);

    // Invalidate individual board membership cache for all members
    await Promise.all(
      memberIds.map((memberId) =>
        this.cachedService.del(CACHE.TASK.KEYS.BOARD_MEMBERSHIP(id, memberId)),
      ),
    );

    return `Board with ID ${id} has been deleted`;
  }

  async getBoardsInWorkspace(
    queryDto: QueryBoardDto,
    requesterUserId: string,
  ): Promise<IOffsetResponse<IBoardResponse[]>> {
    const { workspaceId, page = 1, limit = 20 } = queryDto;

    const memberId = await this.commonService.getMemberId(
      workspaceId,
      requesterUserId,
    );

    return await this.cachedService.getOrSetList({
      trackerKey: CACHE.TASK.TRACKERS.BOARD_LIST_VERSION(workspaceId, memberId),
      keyBuilder: (version) =>
        CACHE.TASK.KEYS.BOARD_LIST(workspaceId, memberId, version, page, limit),
      ttl: TTL.LONG,
      fetcher: async () => {
        const skip = (page - 1) * limit;

        const query = this.boardRepo
          .createQueryBuilder('board')
          .innerJoin(BoardMemberEntity, 'member', 'member.boardId = board.id')
          .where('board.workspaceId = :workspaceId', { workspaceId })
          .andWhere('member.memberId = :memberId', { memberId })
          .orderBy('board.createdAt', 'DESC')
          .skip(skip)
          .take(limit);

        const [items, total] = await query.getManyAndCount();

        this.logger.log('Boards fetched successfully', {
          workspaceId,
          memberId,
          count: items.length,
        });

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
      },
    });
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
    const { workspaceId } = await this.dataSource.transaction(
      async (manager) => {
        await this.commonService.checkBoardMembership(
          boardId,
          requesterId,
          manager,
        );

        const existing = await manager.findOne(BoardMemberEntity, {
          where: { boardId, memberId },
        });
        if (existing)
          throw new RpcException(TASK_ERROR.MEMBER_ALREADY_IN_BOARD);

        const boardMember = manager.create(BoardMemberEntity, {
          boardId,
          memberId,
        });
        await manager.save(boardMember);

        const board = await manager.findOne(TaskBoardEntity, {
          where: { id: boardId },
          select: ['workspaceId'],
        });
        if (!board) throw new RpcException(TASK_ERROR.BOARD_NOT_FOUND);

        return { workspaceId: board.workspaceId };
      },
    );

    await this.cachedService.invalidateList(
      CACHE.TASK.TRACKERS.BOARD_LIST_VERSION(workspaceId, memberId),
    );

    // Invalidate individual board membership cache
    this.cachedService.del(CACHE.TASK.KEYS.BOARD_MEMBERSHIP(boardId, memberId));

    return 'Add member to board successfully';
  }

  async removeMemberFromBoard(
    boardId: string,
    memberId: string,
    requesterId: string,
  ): Promise<string> {
    const { workspaceId } = await this.dataSource.transaction(
      async (manager) => {
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

        await manager.delete(BoardMemberEntity, {
          boardId,
          memberId,
        });

        return { workspaceId: board.workspaceId };
      },
    );

    await this.cachedService.invalidateList(
      CACHE.TASK.TRACKERS.BOARD_LIST_VERSION(workspaceId, memberId),
    );

    // Invalidate individual board membership cache
    this.cachedService.del(CACHE.TASK.KEYS.BOARD_MEMBERSHIP(boardId, memberId));

    return 'Remove member from board successfully';
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
