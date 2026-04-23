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
  CreateChecklistApiDto,
  UpdateChecklistApiDto,
  AddChecklistItemApiDto,
  UpdateChecklistItemApiDto,
} from './dto/task-api.dto';
import { WorkspaceRoleEnum } from '@slack/constants';

@ApiTags('Tasks')
@Controller('tasks')
@ApiBearerAuth()
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  // --- BOARDS ---
  @Post('boards')
  @ApiOperation({ summary: 'Create a new task board' })
  async createBoard(
    @Body() dto: CreateBoardApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.workspaceService.checkPermission(dto.workspaceId, user.sub, [
      WorkspaceRoleEnum.ADMIN,
      WorkspaceRoleEnum.OWNER,
    ]);
    return this.taskService.createBoard(dto, user.sub);
  }

  @Patch('boards/:id')
  @ApiOperation({ summary: 'Update board info' })
  async updateBoard(
    @Param('id') id: string,
    @Body() dto: UpdateBoardApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.updateBoard(id, dto, user.sub);
  }

  @Delete('boards/:id')
  @ApiOperation({ summary: 'Delete a board' })
  async deleteBoard(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.taskService.deleteBoard(id, user.sub);
  }

  @Get('boards')
  @ApiOperation({ summary: 'Get all boards in a workspace' })
  async getBoards(
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.getBoards(workspaceId, user.sub);
  }

  @Get('boards/:id')
  @ApiOperation({ summary: 'Get board details' })
  async getBoardDetails(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.taskService.getBoardDetails(id, user.sub);
  }

  @Get('boards/:id/members')
  @ApiOperation({ summary: 'Get board members' })
  async getBoardMembers(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.taskService.getBoardMembers(id, user.sub);
  }

  @Post('boards/:id/members')
  @ApiOperation({ summary: 'Add member to board' })
  async addMemberToBoard(
    @Param('id') boardId: string,
    @Body() dto: AddMemberToBoardApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    // Permission check for adding member is still handled in gateway/microservice as needed
    // But we pass user.sub to identify the requester
    return this.taskService.addMemberToBoard(boardId, dto.memberId, user.sub);
  }

  @Delete('boards/:id/members/:memberId')
  @ApiOperation({ summary: 'Remove member from board' })
  async removeMemberFromBoard(
    @Param('id') boardId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.removeMemberFromBoard(boardId, memberId, user.sub);
  }

  // --- GROUPS ---
  @Post('groups')
  @ApiOperation({ summary: 'Add a group to a board' })
  async createGroup(
    @Body() dto: CreateGroupApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.createGroup(dto, user.sub);
  }

  @Patch('groups/:id')
  @ApiOperation({ summary: 'Update group info' })
  async updateGroup(
    @Param('id') id: string,
    @Body() dto: UpdateGroupApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.updateGroup(id, dto, user.sub);
  }

  @Delete('groups/:id')
  @ApiOperation({ summary: 'Remove group from board' })
  async deleteGroup(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.taskService.deleteGroup(id, user.sub);
  }

  @Get('groups')
  @ApiOperation({ summary: 'Get groups by board ID' })
  async getGroups(
    @Query('boardId') boardId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.getGroups(boardId, user.sub);
  }

  // --- TASKS ---
  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  async createTask(
    @Body() dto: CreateTaskApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.createTask(dto, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update task details' })
  async updateTask(
    @Param('id') id: string,
    @Body() dto: UpdateTaskApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.updateTask(id, dto, user.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove task' })
  async deleteTask(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.taskService.deleteTask(id, user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get task details' })
  async getTaskDetails(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.taskService.getTaskDetails(id, user.sub);
  }

  @Get()
  @ApiOperation({ summary: 'Get tasks in a group' })
  async getTasks(
    @Query('groupId') groupId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.getTasks(groupId, user.sub);
  }

  @Post(':id/assign/:memberId')
  @ApiOperation({ summary: 'Assign member to task' })
  async assignMemberToTask(
    @Param('id') taskId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.assignMemberToTask(taskId, memberId, user.sub);
  }

  @Post(':id/unassign/:memberId')
  @ApiOperation({ summary: 'Unassign member from task' })
  async unassignMemberFromTask(
    @Param('id') taskId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.unassignMemberFromTask(taskId, memberId, user.sub);
  }

  @Post(':id/toggle-label')
  @ApiOperation({ summary: 'Toggle label for task' })
  async toggleTaskLabel(
    @Param('id') taskId: string,
    @Body() dto: ToggleTaskLabelApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.toggleTaskLabel(taskId, dto.labelId, user.sub);
  }

  // --- LABELS ---
  @Post('labels')
  @ApiOperation({ summary: 'Create a new label' })
  async createLabel(
    @Body() dto: CreateLabelApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.workspaceService.checkPermission(dto.workspaceId, user.sub, [
      WorkspaceRoleEnum.ADMIN,
      WorkspaceRoleEnum.OWNER,
    ]);
    return this.taskService.createLabel(dto);
  }

  @Patch('labels/:id')
  @ApiOperation({ summary: 'Update label info' })
  async updateLabel(@Param('id') id: string, @Body() dto: UpdateLabelApiDto) {
    return this.taskService.updateLabel(id, dto);
  }

  @Delete('labels/:id')
  @ApiOperation({ summary: 'Delete label' })
  async deleteLabel(@Param('id') id: string) {
    return this.taskService.deleteLabel(id);
  }

  @Get('labels')
  @ApiOperation({ summary: 'Get labels in a workspace' })
  async getLabels(@Query('workspaceId') workspaceId: string) {
    return this.taskService.getLabels(workspaceId);
  }

  // --- CHECKLISTS ---
  @Post('checklists')
  @ApiOperation({ summary: 'Create a new checklist' })
  async createChecklist(
    @Body() dto: CreateChecklistApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.createChecklist(dto, user.sub);
  }

  @Patch('checklists/:id')
  @ApiOperation({ summary: 'Update checklist info' })
  async updateChecklist(
    @Param('id') id: string,
    @Body() dto: UpdateChecklistApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.updateChecklist(id, dto, user.sub);
  }

  @Delete('checklists/:id')
  @ApiOperation({ summary: 'Delete a checklist' })
  async deleteChecklist(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.taskService.deleteChecklist(id, user.sub);
  }

  @Get('checklists')
  @ApiOperation({ summary: 'Get checklists in a task' })
  async getChecklists(
    @Query('taskId') taskId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.getChecklists(taskId, user.sub);
  }

  @Post('checklists/items')
  @ApiOperation({ summary: 'Add an item to a checklist' })
  async addChecklistItem(
    @Body() dto: AddChecklistItemApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.addChecklistItem(dto, user.sub);
  }

  @Patch('checklists/items/:id')
  @ApiOperation({ summary: 'Update checklist item' })
  async updateChecklistItem(
    @Param('id') id: string,
    @Body() dto: UpdateChecklistItemApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.updateChecklistItem(id, dto, user.sub);
  }

  @Delete('checklists/items/:id')
  @ApiOperation({ summary: 'Delete checklist item' })
  async deleteChecklistItem(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.deleteChecklistItem(id, user.sub);
  }

  @Post('checklists/items/:id/toggle')
  @ApiOperation({ summary: 'Toggle checklist item completion' })
  async toggleChecklistItem(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.taskService.toggleChecklistItem(id, user.sub);
  }
}
