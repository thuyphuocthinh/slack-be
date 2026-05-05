import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, TASK_MSG_PATTERN } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
import {
  CreateBoardRequestDto,
  UpdateBoardRequestDto,
  QueryBoardRequestDto,
  CreateGroupRequestDto,
  UpdateGroupRequestDto,
  CreateTaskRequestDto,
  UpdateTaskRequestDto,
  QueryTaskRequestDto,
  CreateLabelRequestDto,
  UpdateLabelRequestDto,
  CreateChecklistRequestDto,
  UpdateChecklistRequestDto,
  AddChecklistItemRequestDto,
  UpdateChecklistItemRequestDto,
  ChangeGroupOrderRequestDto,
  DragDropTaskRequestDto,
  CreateAttachmentRequestDto,
} from './dto/task-request.dto';

@Injectable()
export class TaskService {
  constructor(
    @Inject(NAME_SERVICE_TCP.TASK_SERVICE)
    private readonly taskClient: ClientProxy,
  ) {}

  // --- BOARD ---
  async createBoard(dto: CreateBoardRequestDto, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.BOARD.CREATE, {
            dto,
            requesterId,
          }),
        ),
      'createBoard',
      'TaskGatewayService',
    );
  }

  async updateBoard(
    id: string,
    dto: UpdateBoardRequestDto,
    requesterId: string,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.BOARD.UPDATE, {
            id,
            dto,
            requesterId,
          }),
        ),
      'updateBoard',
      'TaskGatewayService',
    );
  }

  async deleteBoard(id: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.BOARD.DELETE, {
            id,
            requesterId,
          }),
        ),
      'deleteBoard',
      'TaskGatewayService',
    );
  }

  async getBoards(queryDto: QueryBoardRequestDto, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.BOARD.GET_ALL_IN_WORKSPACE, {
            queryDto,
            requesterId,
          }),
        ),
      'getBoards',
      'TaskGatewayService',
    );
  }

  async getBoardDetails(id: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.BOARD.GET_DETAILS, {
            id,
            requesterId,
          }),
        ),
      'getBoardDetails',
      'TaskGatewayService',
    );
  }

  async getBoardMembers(boardId: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.BOARD.GET_MEMBERS, {
            boardId,
            requesterId,
          }),
        ),
      'getBoardMembers',
      'TaskGatewayService',
    );
  }

  async addMemberToBoard(
    boardId: string,
    memberId: string,
    requesterId: string,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.BOARD.ADD_MEMBER, {
            boardId,
            memberId,
            requesterId,
          }),
        ),
      'addMemberToBoard',
      'TaskGatewayService',
    );
  }

  async removeMemberFromBoard(
    boardId: string,
    memberId: string,
    requesterId: string,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.BOARD.REMOVE_MEMBER, {
            boardId,
            memberId,
            requesterId,
          }),
        ),
      'removeMemberFromBoard',
      'TaskGatewayService',
    );
  }

  // --- GROUP ---
  async createGroup(dto: CreateGroupRequestDto, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.GROUP.CREATE, {
            dto,
            requesterId,
          }),
        ),
      'createGroup',
      'TaskGatewayService',
    );
  }

  async updateGroup(
    id: string,
    dto: UpdateGroupRequestDto,
    requesterId: string,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.GROUP.UPDATE, {
            id,
            dto,
            requesterId,
          }),
        ),
      'updateGroup',
      'TaskGatewayService',
    );
  }

  async deleteGroup(id: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.GROUP.DELETE, {
            id,
            requesterId,
          }),
        ),
      'deleteGroup',
      'TaskGatewayService',
    );
  }

  async getGroups(boardId: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.GROUP.GET_ALL_IN_BOARD, {
            boardId,
            requesterId,
          }),
        ),
      'getGroups',
      'TaskGatewayService',
    );
  }

  async changeGroupOrder(dto: ChangeGroupOrderRequestDto, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.GROUP.CHANGE_ORDER, {
            dto,
            requesterId,
          }),
        ),
      'changeGroupOrder',
      'TaskGatewayService',
    );
  }

  // --- TASK ---
  async createTask(dto: CreateTaskRequestDto, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.TASK.CREATE, {
            dto,
            requesterId,
          }),
        ),
      'createTask',
      'TaskGatewayService',
    );
  }

  async updateTask(id: string, dto: UpdateTaskRequestDto, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.TASK.UPDATE, {
            id,
            dto,
            requesterId,
          }),
        ),
      'updateTask',
      'TaskGatewayService',
    );
  }

  async deleteTask(id: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.TASK.DELETE, {
            id,
            requesterId,
          }),
        ),
      'deleteTask',
      'TaskGatewayService',
    );
  }

  async getTaskDetails(id: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.TASK.GET_DETAILS, {
            id,
            requesterId,
          }),
        ),
      'getTaskDetails',
      'TaskGatewayService',
    );
  }

  async getTasks(queryDto: QueryTaskRequestDto, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.TASK.GET_ALL_IN_GROUP, {
            queryDto,
            requesterId,
          }),
        ),
      'getTasks',
      'TaskGatewayService',
    );
  }

  async assignMemberToTask(
    taskId: string,
    memberId: string,
    requesterId: string,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.TASK.ASSIGN_MEMBER, {
            taskId,
            memberId,
            requesterId,
          }),
        ),
      'assignMemberToTask',
      'TaskGatewayService',
    );
  }

  async unassignMemberFromTask(
    taskId: string,
    memberId: string,
    requesterId: string,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.TASK.UNASSIGN_MEMBER, {
            taskId,
            memberId,
            requesterId,
          }),
        ),
      'unassignMemberFromTask',
      'TaskGatewayService',
    );
  }

  async toggleTaskLabel(taskId: string, labelId: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.TASK.TOGGLE_LABEL, {
            taskId,
            labelId,
            requesterId,
          }),
        ),
      'toggleTaskLabel',
      'TaskGatewayService',
    );
  }

  async dragDropTask(dto: DragDropTaskRequestDto, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.TASK.DRAG_DROP, {
            dto,
            requesterId,
          }),
        ),
      'dragDropTask',
      'TaskGatewayService',
    );
  }

  // --- LABEL ---
  async createLabel(dto: CreateLabelRequestDto, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.LABEL.CREATE, {
            dto,
            requesterId,
          }),
        ),
      'createLabel',
      'TaskGatewayService',
    );
  }

  async updateLabel(
    id: string,
    dto: UpdateLabelRequestDto,
    requesterId: string,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.LABEL.UPDATE, {
            id,
            dto,
            requesterId,
          }),
        ),
      'updateLabel',
      'TaskGatewayService',
    );
  }

  async deleteLabel(id: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.LABEL.DELETE, {
            id,
            requesterId,
          }),
        ),
      'deleteLabel',
      'TaskGatewayService',
    );
  }

  async getLabels(boardId: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.LABEL.GET_ALL_IN_BOARD, {
            boardId,
            requesterId,
          }),
        ),
      'getLabels',
      'TaskGatewayService',
    );
  }

  // --- CHECKLIST ---
  async createChecklist(dto: CreateChecklistRequestDto, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.CHECKLIST.CREATE, {
            dto,
            requesterId,
          }),
        ),
      'createChecklist',
      'TaskGatewayService',
    );
  }

  async updateChecklist(
    id: string,
    dto: UpdateChecklistRequestDto,
    requesterId: string,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.CHECKLIST.UPDATE, {
            id,
            dto,
            requesterId,
          }),
        ),
      'updateChecklist',
      'TaskGatewayService',
    );
  }

  async deleteChecklist(id: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.CHECKLIST.DELETE, {
            id,
            requesterId,
          }),
        ),
      'deleteChecklist',
      'TaskGatewayService',
    );
  }

  async getChecklists(taskId: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.CHECKLIST.GET_ALL_IN_TASK, {
            taskId,
            requesterId,
          }),
        ),
      'getChecklists',
      'TaskGatewayService',
    );
  }

  async addChecklistItem(dto: AddChecklistItemRequestDto, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.CHECKLIST.ADD_ITEM, {
            dto,
            requesterId,
          }),
        ),
      'addChecklistItem',
      'TaskGatewayService',
    );
  }

  async updateChecklistItem(
    id: string,
    dto: UpdateChecklistItemRequestDto,
    requesterId: string,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.CHECKLIST.UPDATE_ITEM, {
            id,
            dto,
            requesterId,
          }),
        ),
      'updateChecklistItem',
      'TaskGatewayService',
    );
  }

  async deleteChecklistItem(id: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.CHECKLIST.DELETE_ITEM, {
            id,
            requesterId,
          }),
        ),
      'deleteChecklistItem',
      'TaskGatewayService',
    );
  }

  async toggleChecklistItem(id: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.CHECKLIST.TOGGLE_ITEM, {
            id,
            requesterId,
          }),
        ),
      'toggleChecklistItem',
      'TaskGatewayService',
    );
  }

  // --- ATTACHMENTS ---
  async createAttachment(dto: CreateAttachmentRequestDto, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.TASK.ADD_ATTACHMENT, {
            dto,
            requesterId,
          }),
        ),
      'createAttachment',
      'TaskGatewayService',
    );
  }

  async deleteAttachment(id: string, requesterId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.taskClient.send(TASK_MSG_PATTERN.TASK.DELETE_ATTACHMENT, {
            id,
            requesterId,
          }),
        ),
      'deleteAttachment',
      'TaskGatewayService',
    );
  }
}
