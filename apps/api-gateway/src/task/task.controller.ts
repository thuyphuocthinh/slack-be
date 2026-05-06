import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TaskService } from './task.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { CurrentUser, type JwtUser } from '@slack/common';
import {
  CreateBoardApiDto,
  UpdateBoardApiDto,
  CreateGroupApiDto,
  UpdateGroupApiDto,
  CreateTaskApiDto,
  UpdateTaskApiDto,
  CreateLabelApiDto,
  UpdateLabelApiDto,
  AddMemberToBoardApiDto,
  ToggleTaskLabelApiDto,
  QueryBoardApiDto,
  QueryTaskApiDto,
  CreateChecklistApiDto,
  UpdateChecklistApiDto,
  UpdateChecklistItemApiDto,
  ChangeGroupOrderApiDto,
  DragDropTaskApiDto,
  AddChecklistItemApiDto,
  CreateAttachmentApiDto,
  ChangeTaskGroupApiDto,
  FilterTasksApiDto,
} from './dto/task-api.dto';
import {
  CreateBoardRequestDto,
  UpdateBoardRequestDto,
  QueryBoardRequestDto,
  CreateGroupRequestDto,
  UpdateGroupRequestDto,
  CreateLabelRequestDto,
  UpdateLabelRequestDto,
  CreateChecklistRequestDto,
  UpdateChecklistRequestDto,
  AddChecklistItemRequestDto,
  UpdateChecklistItemRequestDto,
  CreateTaskRequestDto,
  UpdateTaskRequestDto,
  QueryTaskRequestDto,
  ChangeGroupOrderRequestDto,
  DragDropTaskRequestDto,
  CreateAttachmentRequestDto,
  ChangeTaskGroupRequestDto,
  FilterTasksDto,
} from './dto/task-request.dto';
import { WorkspaceRoleEnum } from '@slack/constants';

@ApiTags('Tasks')
@Controller('workspaces/:workspaceId')
@ApiBearerAuth()
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    private readonly workspaceService: WorkspaceService,
  ) { }

  // --- BOARDS ---
  @Post('boards')
  @ApiOperation({ summary: 'Create a new task board' })
  async createBoard(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateBoardApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.workspaceService.checkPermission(workspaceId, user.sub, [
      WorkspaceRoleEnum.ADMIN,
      WorkspaceRoleEnum.OWNER,
    ]);
    return this.taskService.createBoard(
      { ...dto, workspaceId, requesterId: user.sub } as CreateBoardRequestDto,
      user.sub,
    );
  }

  @Patch('boards/:id')
  @ApiOperation({ summary: 'Update board info' })
  async updateBoard(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBoardApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.updateBoard(
      id,
      { ...dto, id, requesterId: user.sub } as UpdateBoardRequestDto,
      user.sub,
    );
  }

  @Delete('boards/:id')
  @ApiOperation({ summary: 'Delete a board' })
  async deleteBoard(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.deleteBoard(id, user.sub);
  }

  @Get('boards')
  @ApiOperation({ summary: 'Get all boards in a workspace' })
  async getBoards(
    @Param('workspaceId') workspaceId: string,
    @Query() queryDto: QueryBoardApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.getBoards(
      {
        ...queryDto,
        workspaceId,
        requesterId: user.sub,
      } as QueryBoardRequestDto,
      user.sub,
    );
  }

  @Get('boards/:id')
  @ApiOperation({ summary: 'Get board details' })
  async getBoardDetails(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.getBoardDetails(id, user.sub);
  }

  @Get('boards/:id/members')
  @ApiOperation({ summary: 'Get board members' })
  async getBoardMembers(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.getBoardMembers(id, user.sub);
  }

  @Post('boards/:id/members')
  @ApiOperation({ summary: 'Add member to board' })
  async addMemberToBoard(
    @Param('workspaceId') workspaceId: string,
    @Param('id') boardId: string,
    @Body() dto: AddMemberToBoardApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.addMemberToBoard(boardId, dto.memberId, user.sub);
  }

  @Delete('boards/:id/members/:memberId')
  @ApiOperation({ summary: 'Remove member from board' })
  async removeMemberFromBoard(
    @Param('workspaceId') workspaceId: string,
    @Param('id') boardId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.removeMemberFromBoard(boardId, memberId, user.sub);
  }

  // --- GROUPS ---
  @Post('boards/:id/groups')
  @ApiOperation({ summary: 'Add a group to a board' })
  async createGroup(
    @Param('workspaceId') workspaceId: string,
    @Param('id') boardId: string,
    @Body() dto: CreateGroupApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.createGroup(
      { ...dto, boardId, requesterId: user.sub } as CreateGroupRequestDto,
      user.sub,
    );
  }

  @Patch('groups/:id')
  @ApiOperation({ summary: 'Update group info' })
  async updateGroup(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateGroupApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.updateGroup(
      id,
      { ...dto, id, requesterId: user.sub } as UpdateGroupRequestDto,
      user.sub,
    );
  }

  @Delete('groups/:id')
  @ApiOperation({ summary: 'Remove group from board' })
  async deleteGroup(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.deleteGroup(id, user.sub);
  }

  @Get('boards/:id/groups')
  @ApiOperation({ summary: 'Get groups by board ID' })
  async getGroups(
    @Param('workspaceId') workspaceId: string,
    @Param('id') boardId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.getGroups(boardId, user.sub);
  }

  @Patch('boards/:id/groups/order')
  @ApiOperation({ summary: 'Change group order' })
  async changeGroupOrder(
    @Param('workspaceId') workspaceId: string,
    @Param('id') boardId: string,
    @Body() dto: ChangeGroupOrderApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.changeGroupOrder(
      { ...dto, requesterId: user.sub } as ChangeGroupOrderRequestDto,
      user.sub,
    );
  }

  // --- LABELS ---
  @Post('boards/:id/labels')
  @ApiOperation({ summary: 'Create a new label' })
  async createLabel(
    @Param('workspaceId') workspaceId: string,
    @Param('id') boardId: string,
    @Body() dto: CreateLabelApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.createLabel(
      { ...dto, boardId, requesterId: user.sub } as CreateLabelRequestDto,
      user.sub,
    );
  }

  @Patch('labels/:id')
  @ApiOperation({ summary: 'Update label info' })
  async updateLabel(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLabelApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.updateLabel(
      id,
      { ...dto, id, requesterId: user.sub } as UpdateLabelRequestDto,
      user.sub,
    );
  }

  @Delete('labels/:id')
  @ApiOperation({ summary: 'Delete label' })
  async deleteLabel(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.deleteLabel(id, user.sub);
  }

  @Get('boards/:id/labels')
  @ApiOperation({ summary: 'Get labels in a board' })
  async getLabels(
    @Param('workspaceId') workspaceId: string,
    @Param('id') boardId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.getLabels(boardId, user.sub);
  }

  // --- CHECKLISTS ---
  @Post('tasks/:id/checklists')
  @ApiOperation({ summary: 'Create a new checklist' })
  async createChecklist(
    @Param('workspaceId') workspaceId: string,
    @Param('id') taskId: string,
    @Body() dto: CreateChecklistApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.createChecklist(
      { ...dto, taskId, requesterId: user.sub } as CreateChecklistRequestDto,
      user.sub,
    );
  }

  @Patch('checklists/:id')
  @ApiOperation({ summary: 'Update checklist info' })
  async updateChecklist(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateChecklistApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.updateChecklist(
      id,
      { ...dto, id, requesterId: user.sub } as UpdateChecklistRequestDto,
      user.sub,
    );
  }

  @Delete('checklists/:id')
  @ApiOperation({ summary: 'Delete a checklist' })
  async deleteChecklist(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.deleteChecklist(id, user.sub);
  }

  @Get('tasks/:id/checklists')
  @ApiOperation({ summary: 'Get checklists in a task' })
  async getChecklists(
    @Param('workspaceId') workspaceId: string,
    @Param('id') taskId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.getChecklists(taskId, user.sub);
  }

  @Post('checklists/:id/items')
  @ApiOperation({ summary: 'Add an item to a checklist' })
  async addChecklistItem(
    @Param('workspaceId') workspaceId: string,
    @Param('id') checklistId: string,
    @Body() dto: AddChecklistItemApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.addChecklistItem(
      {
        ...dto,
        checklistId,
        requesterId: user.sub,
      } as AddChecklistItemRequestDto,
      user.sub,
    );
  }

  @Patch('checklists/items/:id')
  @ApiOperation({ summary: 'Update checklist item' })
  async updateChecklistItem(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateChecklistItemApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.updateChecklistItem(
      id,
      { ...dto, id, requesterId: user.sub } as UpdateChecklistItemRequestDto,
      user.sub,
    );
  }

  @Delete('checklists/items/:id')
  @ApiOperation({ summary: 'Delete checklist item' })
  async deleteChecklistItem(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.deleteChecklistItem(id, user.sub);
  }

  @Post('checklists/items/:id/toggle')
  @ApiOperation({ summary: 'Toggle checklist item completion' })
  async toggleChecklistItem(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.toggleChecklistItem(id, user.sub);
  }

  // --- TASKS ---
  @Post('groups/:id/tasks')
  @ApiOperation({ summary: 'Create a new task' })
  async createTask(
    @Param('id') groupId: string,
    @Body() dto: CreateTaskApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.createTask(
      { ...dto, groupId, requesterId: user.sub } as CreateTaskRequestDto,
      user.sub,
    );
  }

  @Patch('tasks/drag-drop')
  @ApiOperation({ summary: 'Drag and drop task' })
  async dragDropTask(
    @Body() dto: DragDropTaskApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.dragDropTask(
      { ...dto, requesterId: user.sub } as DragDropTaskRequestDto,
      user.sub,
    );
  }

  @Patch('tasks/:id')
  @ApiOperation({ summary: 'Update task details' })
  async updateTask(
    @Param('id') id: string,
    @Body() dto: UpdateTaskApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.updateTask(
      id,
      { ...dto, id, requesterId: user.sub } as UpdateTaskRequestDto,
      user.sub,
    );
  }

  @Delete('tasks/:id')
  @ApiOperation({ summary: 'Remove task' })
  async deleteTask(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.deleteTask(id, user.sub);
  }

  @Get('tasks/filter')
  @ApiOperation({ summary: 'Filter tasks' })
  async filterTasks(
    @Query() queryDto: FilterTasksApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.filterTasks(
      { ...queryDto, requesterId: user.sub } as FilterTasksDto,
      user.sub,
    );
  }

  @Get('tasks/:id')
  @ApiOperation({ summary: 'Get task details' })
  async getTaskDetails(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.getTaskDetails(id, user.sub);
  }

  @Get('groups/:id/tasks')
  @ApiOperation({ summary: 'Get tasks in a group' })
  async getTasks(
    @Param('id') groupId: string,
    @Query() queryDto: QueryTaskApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.getTasks(
      { ...queryDto, groupId, requesterId: user.sub } as QueryTaskRequestDto,
      user.sub,
    );
  }

  @Post('tasks/:id/assign/:memberId')
  @ApiOperation({ summary: 'Assign member to task' })
  async assignMemberToTask(
    @Param('id') taskId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.assignMemberToTask(taskId, memberId, user.sub);
  }

  @Post('tasks/:id/unassign/:memberId')
  @ApiOperation({ summary: 'Unassign member from task' })
  async unassignMemberFromTask(
    @Param('id') taskId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.unassignMemberFromTask(taskId, memberId, user.sub);
  }

  @Post('tasks/:id/toggle-label')
  @ApiOperation({ summary: 'Toggle label for task' })
  async toggleTaskLabel(
    @Param('id') taskId: string,
    @Body() dto: ToggleTaskLabelApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.toggleTaskLabel(taskId, dto.labelId, user.sub);
  }


  @Post('tasks/:id/change-group')
  @ApiOperation({ summary: 'Change task group (move task)' })
  async changeTaskGroup(
    @Param('id') taskId: string,
    @Body() dto: ChangeTaskGroupApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.changeTaskGroup(
      {
        ...dto,
        taskId,
        targetGroupId: dto.targetGroupId,
        requesterId: user.sub,
      } as ChangeTaskGroupRequestDto,
      user.sub,
    );
  }


  // --- ATTACHMENTS ---
  @Post('tasks/:id/attachments')
  @ApiOperation({ summary: 'Add attachment to task' })
  async createAttachment(
    @Param('id') taskId: string,
    @Body() dto: CreateAttachmentApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.createAttachment(
      { ...dto, taskId, requesterId: user.sub } as CreateAttachmentRequestDto,
      user.sub,
    );
  }

  @Delete('attachments/:id')
  @ApiOperation({ summary: 'Delete attachment' })
  async deleteAttachment(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.deleteAttachment(id, user.sub);
  }
}
