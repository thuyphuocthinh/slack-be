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
  ) {}

  async checkBoardMembership(
    boardId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const boardRepo = manager
      ? manager.getRepository(TaskBoardEntity)
      : this.boardRepo;
    const boardMemberRepo = manager
      ? manager.getRepository(BoardMemberEntity)
      : this.boardMemberRepo;

    const board = await boardRepo.findOneBy({ id: boardId });
    if (!board) throw new RpcException(TASK_ERROR.BOARD_NOT_FOUND);

    const memberId = await this.getMemberId(board.workspaceId, userId);
    const membership = await boardMemberRepo.findOneBy({ boardId, memberId });
    if (!membership) {
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
      const member = await firstValueFrom(
        this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER, {
          workspaceId,
          userId,
        }),
      );
      if (!member) throw new Error('Member not found');
      return member.id;
    } catch (error) {
      this.logger.error('Get member failed', error);
      throw new RpcException(TASK_ERROR.NOT_MEMBER_OF_WORKSPACE);
    }
  }
}
