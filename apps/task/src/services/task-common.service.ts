import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { BoardMemberEntity } from '../entity/board_member.entity';
import { TaskBoardEntity } from '../entity/task_board.entity';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  TASK_ERROR,
  NAME_SERVICE_TCP,
  WORKSPACE_MESSAGE_PATTERNS,
} from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { CACHE, CachedService, TTL } from '@slack/cached';

@Injectable()
export class TaskCommonService {
  private readonly logger = new Logger(TaskCommonService.name);

  constructor(
    @InjectRepository(BoardMemberEntity)
    private readonly boardMemberRepo: Repository<BoardMemberEntity>,
    @InjectRepository(TaskBoardEntity)
    private readonly boardRepo: Repository<TaskBoardEntity>,
    @Inject(NAME_SERVICE_TCP.WORKSPACE_SERVICE)
    private readonly workspaceClient: ClientProxy,
    private readonly cachedService: CachedService,
  ) {}

  async getBoardById(boardId: string): Promise<TaskBoardEntity> {
    return await this.cachedService.getOrSetDetail(
      CACHE.TASK.KEYS.BOARD_DETAIL(boardId),
      TTL.LONG,
      async () => {
        const board = await this.boardRepo.findOneBy({ id: boardId });
        if (!board) throw new RpcException(TASK_ERROR.BOARD_NOT_FOUND);
        return board;
      },
    );
  }

  async checkBoardMembership(
    boardId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    if (manager) {
      const boardRepo = manager.getRepository(TaskBoardEntity);
      const boardMemberRepo = manager.getRepository(BoardMemberEntity);

      const board = await boardRepo.findOneBy({ id: boardId });
      if (!board) throw new RpcException(TASK_ERROR.BOARD_NOT_FOUND);

      const memberId = await this.getMemberId(board.workspaceId, userId);
      const membership = await boardMemberRepo.findOneBy({ boardId, memberId });
      if (!membership) throw new RpcException(TASK_ERROR.MEMBER_NOT_IN_BOARD);
      return;
    }

    const cacheKey = CACHE.TASK.KEYS.BOARD_MEMBERSHIP(boardId, userId);
    const isMember = await this.cachedService.getOrSetDetail(
      cacheKey,
      TTL.SHORT,
      async () => {
        const board = await this.getBoardById(boardId);
        const memberId = await this.getMemberId(board.workspaceId, userId);
        const membership = await this.boardMemberRepo.findOneBy({
          boardId,
          memberId,
        });
        return !!membership;
      },
    );

    if (!isMember) {
      throw new RpcException(TASK_ERROR.MEMBER_NOT_IN_BOARD);
    }
  }

  async checkWorkspaceMembership(
    workspaceId: string,
    userId: string,
  ): Promise<string> {
    return await this.getMemberId(workspaceId, userId);
  }

  async getMemberId(workspaceId: string, userId: string): Promise<string> {
    try {
      const member = await this.cachedService.getOrSetDetail(
        CACHE.WORKSPACE.KEYS.IS_MEMBER(workspaceId, userId),
        TTL.SHORT,
        async () => {
          return await firstValueFrom(
            this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER, {
              workspaceId,
              userId,
            }),
          );
        },
      );
      if (!member) throw new Error('Member not found');
      return member.id;
    } catch (error) {
      this.logger.error('Get member failed', error);
      throw new RpcException(TASK_ERROR.NOT_MEMBER_OF_WORKSPACE);
    }
  }

  async getMemberRole(workspaceId: string, userId: string): Promise<string> {
    try {
      const member = await this.cachedService.getOrSetDetail(
        CACHE.WORKSPACE.KEYS.IS_MEMBER(workspaceId, userId),
        TTL.SHORT,
        async () => {
          return await firstValueFrom(
            this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER, {
              workspaceId,
              userId,
            }),
          );
        },
      );
      if (!member) throw new Error('Member not found');
      return member.role;
    } catch (error) {
      this.logger.error('Get member role failed', error);
      throw new RpcException(TASK_ERROR.NOT_MEMBER_OF_WORKSPACE);
    }
  }
}
