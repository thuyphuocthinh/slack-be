import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TaskService } from './services/task.service';
import { BoardService } from './services/board.service';
import { GroupService } from './services/group.service';
import { LabelService } from './services/label.service';
import { ChecklistService } from './services/checklist.service';
import { TASK_MSG_PATTERN } from '@slack/constants';
import { CreateBoardDto, UpdateBoardDto } from './dto/board.dto';
import { CreateGroupDto, UpdateGroupDto } from './dto/group.dto';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { CreateLabelDto, UpdateLabelDto } from './dto/label.dto';
import {
  CreateChecklistDto,
  UpdateChecklistDto,
  AddChecklistItemDto,
  UpdateChecklistItemDto,
} from './dto/checklist.dto';

@Controller()
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    private readonly boardService: BoardService,
    private readonly groupService: GroupService,
    private readonly labelService: LabelService,
    private readonly checklistService: ChecklistService,
  ) {}

  // --- BOARD ---
  @MessagePattern(TASK_MSG_PATTERN.BOARD.CREATE)
  async createNewBoard(
    @Payload()
    { dto, requesterId }: { dto: CreateBoardDto; requesterId: string },
  ) {
    return this.boardService.createNewBoard(dto, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.BOARD.UPDATE)
  async updateBoardInfo(
    @Payload()
    {
      id,
      dto,
      requesterId,
    }: {
      id: string;
      dto: UpdateBoardDto;
      requesterId: string;
    },
  ) {
    return this.boardService.updateBoardInfo(id, dto, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.BOARD.DELETE)
  async deleteBoard(
    @Payload() { id, requesterId }: { id: string; requesterId: string },
  ) {
    return this.boardService.deleteBoard(id, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.BOARD.GET_ALL_IN_WORKSPACE)
  async getBoardsInWorkspace(
    @Payload()
    { workspaceId, requesterId }: { workspaceId: string; requesterId: string },
  ) {
    return this.boardService.getBoardsInWorkspace(workspaceId, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.BOARD.GET_DETAILS)
  async getBoardDetails(
    @Payload() { id, requesterId }: { id: string; requesterId: string },
  ) {
    return this.boardService.getBoardDetails(id, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.BOARD.GET_MEMBERS)
  async getBoardMembers(
    @Payload()
    { boardId, requesterId }: { boardId: string; requesterId: string },
  ) {
    return this.boardService.getBoardMembers(boardId, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.BOARD.ADD_MEMBER)
  async addMemberToBoard(
    @Payload()
    {
      boardId,
      memberId,
      requesterId,
    }: {
      boardId: string;
      memberId: string;
      requesterId: string;
    },
  ) {
    return this.boardService.addMemberToBoard(boardId, memberId, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.BOARD.REMOVE_MEMBER)
  async removeMemberFromBoard(
    @Payload()
    {
      boardId,
      memberId,
      requesterId,
    }: {
      boardId: string;
      memberId: string;
      requesterId: string;
    },
  ) {
    return this.boardService.removeMemberFromBoard(
      boardId,
      memberId,
      requesterId,
    );
  }

  // --- GROUP ---
  @MessagePattern(TASK_MSG_PATTERN.GROUP.CREATE)
  async addGroupToBoard(
    @Payload()
    { dto, requesterId }: { dto: CreateGroupDto; requesterId: string },
  ) {
    return this.groupService.addGroupToBoard(dto, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.GROUP.UPDATE)
  async updateGroupInfo(
    @Payload()
    {
      id,
      dto,
      requesterId,
    }: {
      id: string;
      dto: UpdateGroupDto;
      requesterId: string;
    },
  ) {
    return this.groupService.updateGroupInfo(id, dto, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.GROUP.DELETE)
  async removeGroupFromBoard(
    @Payload() { id, requesterId }: { id: string; requesterId: string },
  ) {
    return this.groupService.removeGroupFromBoard(id, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.GROUP.GET_ALL_IN_BOARD)
  async getGroupsByBoardId(
    @Payload()
    { boardId, requesterId }: { boardId: string; requesterId: string },
  ) {
    return this.groupService.getGroupsByBoardId(boardId, requesterId);
  }

  // --- TASK ---
  @MessagePattern(TASK_MSG_PATTERN.TASK.CREATE)
  async createNewTask(
    @Payload()
    { dto, requesterId }: { dto: CreateTaskDto; requesterId: string },
  ) {
    return this.taskService.createNewTask(dto, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.TASK.UPDATE)
  async updateTaskDetails(
    @Payload()
    {
      id,
      dto,
      requesterId,
    }: {
      id: string;
      dto: UpdateTaskDto;
      requesterId: string;
    },
  ) {
    return this.taskService.updateTaskDetails(id, dto, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.TASK.DELETE)
  async removeTask(
    @Payload() { id, requesterId }: { id: string; requesterId: string },
  ) {
    return this.taskService.removeTask(id, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.TASK.GET_DETAILS)
  async getTaskDetails(
    @Payload() { id, requesterId }: { id: string; requesterId: string },
  ) {
    return this.taskService.getTaskDetails(id, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.TASK.GET_ALL_IN_GROUP)
  async getTasksInGroup(
    @Payload()
    { groupId, requesterId }: { groupId: string; requesterId: string },
  ) {
    return this.taskService.getTasksInGroup(groupId, requesterId);
  }

  // @MessagePattern(TASK_MSG_PATTERN.TASK.GET_MEMBERS)
  // async getTaskMembers(@Payload() taskId: string) {
  //   return this.taskService.getTaskMembers(taskId);
  // }

  @MessagePattern(TASK_MSG_PATTERN.TASK.ASSIGN_MEMBER)
  async assignMemberToTask(
    @Payload()
    {
      taskId,
      memberId,
      requesterId,
    }: {
      taskId: string;
      memberId: string;
      requesterId: string;
    },
  ) {
    return this.taskService.assignMemberToTask(taskId, memberId, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.TASK.UNASSIGN_MEMBER)
  async unassignMemberFromTask(
    @Payload()
    {
      taskId,
      memberId,
      requesterId,
    }: {
      taskId: string;
      memberId: string;
      requesterId: string;
    },
  ) {
    return this.taskService.unassignMemberFromTask(
      taskId,
      memberId,
      requesterId,
    );
  }

  @MessagePattern(TASK_MSG_PATTERN.TASK.TOGGLE_LABEL)
  async toggleTaskLabel(
    @Payload()
    {
      taskId,
      labelId,
      requesterId,
    }: {
      taskId: string;
      labelId: string;
      requesterId: string;
    },
  ) {
    return this.taskService.toggleTaskLabel(taskId, labelId, requesterId);
  }

  // --- LABEL ---
  @MessagePattern(TASK_MSG_PATTERN.LABEL.CREATE)
  async createNewLabel(@Payload() dto: CreateLabelDto) {
    return this.labelService.createNewLabel(dto);
  }

  @MessagePattern(TASK_MSG_PATTERN.LABEL.UPDATE)
  async updateLabelInfo(
    @Payload() { id, dto }: { id: string; dto: UpdateLabelDto },
  ) {
    return this.labelService.updateLabelInfo(id, dto);
  }

  @MessagePattern(TASK_MSG_PATTERN.LABEL.DELETE)
  async deleteLabel(@Payload() id: string) {
    return this.labelService.deleteLabel(id);
  }

  @MessagePattern(TASK_MSG_PATTERN.LABEL.GET_ALL_IN_WORKSPACE)
  async getLabelsInWorkspace(@Payload() workspaceId: string) {
    return this.labelService.getLabelsInWorkspace(workspaceId);
  }

  // --- CHECKLIST ---
  @MessagePattern(TASK_MSG_PATTERN.CHECKLIST.CREATE)
  async createChecklist(
    @Payload()
    { dto, requesterId }: { dto: CreateChecklistDto; requesterId: string },
  ) {
    return this.checklistService.createChecklist(dto, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.CHECKLIST.UPDATE)
  async updateChecklist(
    @Payload()
    {
      id,
      dto,
      requesterId,
    }: {
      id: string;
      dto: UpdateChecklistDto;
      requesterId: string;
    },
  ) {
    return this.checklistService.updateChecklist(id, dto, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.CHECKLIST.DELETE)
  async deleteChecklist(
    @Payload() { id, requesterId }: { id: string; requesterId: string },
  ) {
    return this.checklistService.deleteChecklist(id, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.CHECKLIST.GET_ALL_IN_TASK)
  async getChecklistsInTask(
    @Payload() { taskId, requesterId }: { taskId: string; requesterId: string },
  ) {
    return this.checklistService.getChecklistsInTask(taskId, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.CHECKLIST.ADD_ITEM)
  async addChecklistItem(
    @Payload()
    { dto, requesterId }: { dto: AddChecklistItemDto; requesterId: string },
  ) {
    return this.checklistService.addChecklistItem(dto, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.CHECKLIST.UPDATE_ITEM)
  async updateChecklistItem(
    @Payload()
    {
      id,
      dto,
      requesterId,
    }: {
      id: string;
      dto: UpdateChecklistItemDto;
      requesterId: string;
    },
  ) {
    return this.checklistService.updateChecklistItem(id, dto, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.CHECKLIST.DELETE_ITEM)
  async deleteChecklistItem(
    @Payload() { id, requesterId }: { id: string; requesterId: string },
  ) {
    return this.checklistService.deleteChecklistItem(id, requesterId);
  }

  @MessagePattern(TASK_MSG_PATTERN.CHECKLIST.TOGGLE_ITEM)
  async toggleChecklistItem(
    @Payload() { id, requesterId }: { id: string; requesterId: string },
  ) {
    return this.checklistService.toggleChecklistItem(id, requesterId);
  }
}
