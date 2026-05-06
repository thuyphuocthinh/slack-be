import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { WorkspaceService } from './workspace.service';
import {
  CreateWorkspaceApiDto,
  InviteMemberApiDto,
  AddMemberDirectApiDto,
  ChangeRoleApiDto,
  TransferOwnershipApiDto,
  CreateLinkApiDto,
  UpdateWorkspaceApiDto,
  AddBatchMembersApiDto,
  GetWorkspacesApiDto,
} from './dto/workspace-api.dto';
import { CurrentUser, type JwtUser } from '@slack/common';

@ApiTags('Workspaces')
@Controller('workspaces')
@ApiBearerAuth()
export class WorkspaceController {
  private readonly logger = new Logger(WorkspaceController.name);
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new workspace' })
  @ApiResponse({ status: 201, description: 'Workspace created successfully' })
  async createWorkspace(
    @Body() data: CreateWorkspaceApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.createWorkspace({
      ...data,
      ownerUserId: user.sub,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a workspace' })
  @ApiResponse({ status: 200, description: 'Workspace updated successfully' })
  async updateWorkspace(
    @Param('id') id: string,
    @Body() data: UpdateWorkspaceApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.updateWorkspace({
      workspaceId: id,
      ...data,
      updatedBy: user.sub,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get all workspaces for the current user' })
  @ApiResponse({
    status: 200,
    description: 'Workspaces retrieved successfully',
  })
  async getWorkspaces(
    @Query() query: GetWorkspacesApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.getWorkspaces({
      userId: user.sub,
      ...query,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a workspace by ID' })
  @ApiResponse({ status: 200, description: 'Workspace retrieved successfully' })
  async getWorkspace(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return await this.workspaceService.getWorkspace(id, user.sub);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Get all members of a workspace' })
  @ApiResponse({ status: 200, description: 'Members retrieved successfully' })
  async getMembers(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return await this.workspaceService.getMembers(id, user.sub);
  }

  @Get(':id/members/:userId/detail')
  @ApiOperation({ summary: 'Get member detail by ID' })
  @ApiResponse({ status: 200, description: 'Member detail retrieved successfully' })
  async getMemberDetail(
    @Param('id') workspaceId: string,
    @Param('userId') userId: string,
  ) {
    return await this.workspaceService.getMemberDetail(workspaceId, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a workspace' })
  @ApiResponse({ status: 200, description: 'Workspace deleted successfully' })
  async deleteWorkspace(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return await this.workspaceService.deleteWorkspace({
      workspaceId: id,
      ownerUserId: user.sub,
    });
  }

  @Post(':id/invite')
  @ApiOperation({ summary: 'Invite a member to a workspace' })
  @ApiResponse({ status: 201, description: 'Invitation sent successfully' })
  async inviteMember(
    @Param('id') id: string,
    @Body() data: InviteMemberApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.inviteMember({
      workspaceId: id,
      ...data,
      invitedBy: user.sub,
    });
  }

  @Post('accept-invite')
  @ApiOperation({ summary: 'Accept a workspace invitation' })
  @ApiResponse({
    status: 200,
    description: 'Joined workspace successfully',
  })
  async acceptInvite(
    @Query('code') code: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.acceptInvite({
      token: code,
      userId: user.sub,
    });
  }

  @Post(':id/add-member')
  @ApiOperation({ summary: 'Directly add a member to a workspace' })
  @ApiResponse({ status: 201, description: 'Member added successfully' })
  async addMemberDirect(
    @Param('id') id: string,
    @Body() data: AddMemberDirectApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.addMemberDirect({
      workspaceId: id,
      ...data,
      adminUserId: user.sub,
    });
  }

  @Post(':id/add-members')
  @ApiOperation({ summary: 'Add multiple members to a workspace' })
  @ApiResponse({ status: 201, description: 'Members added successfully' })
  async addBatchMembers(
    @Param('id') id: string,
    @Body() data: AddBatchMembersApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.addBatchMembers({
      workspaceId: id,
      userIds: data.userIds,
      role: data.role,
      adminUserId: user.sub,
    });
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a member from a workspace' })
  @ApiResponse({ status: 200, description: 'Member removed successfully' })
  async removeMember(
    @Param('id') workspaceId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.removeMember({
      workspaceId,
      targetUserId: userId,
      adminUserId: user.sub,
    });
  }

  @Post(':id/leave')
  @ApiOperation({ summary: 'Leave a workspace' })
  @ApiResponse({ status: 200, description: 'Left workspace successfully' })
  async leaveWorkspace(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return await this.workspaceService.leaveWorkspace({
      workspaceId: id,
      userId: user.sub,
    });
  }

  @Patch(':id/members/:userId/role')
  @ApiOperation({ summary: 'Change a members role in a workspace' })
  @ApiResponse({ status: 200, description: 'Role changed successfully' })
  async changeRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() data: ChangeRoleApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.changeRole({
      workspaceId: id,
      targetUserId: userId,
      newRole: data.newRole,
      adminUserId: user.sub,
    });
  }

  @Post(':id/transfer-ownership')
  @ApiOperation({ summary: 'Transfer workspace ownership' })
  @ApiResponse({
    status: 200,
    description: 'Ownership transferred successfully',
  })
  async transferOwnership(
    @Param('id') id: string,
    @Body() data: TransferOwnershipApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.transferOwnership({
      workspaceId: id,
      targetUserId: data.targetUserId,
      ownerUserId: user.sub,
    });
  }

  @Post('invites/:inviteId/resend')
  @ApiOperation({ summary: 'Resend a workspace invitation' })
  @ApiResponse({ status: 200, description: 'Invitation resent successfully' })
  async resendInvite(
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.resendInvite({
      inviteId,
      adminUserId: user.sub,
    });
  }

  @Post('invites/:inviteId/revoke')
  @ApiOperation({ summary: 'Revoke a workspace invitation' })
  @ApiResponse({ status: 200, description: 'Invitation revoked successfully' })
  async revokeInvite(
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.revokeInvite({
      inviteId,
      adminUserId: user.sub,
    });
  }

  @Post(':id/links')
  @ApiOperation({ summary: 'Create a public invite link' })
  @ApiResponse({ status: 201, description: 'Link created successfully' })
  async createLink(
    @Param('id') id: string,
    @Body() data: CreateLinkApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.createLink({
      workspaceId: id,
      ...data,
      adminUserId: user.sub,
    });
  }

  @Get(':id/links')
  @ApiOperation({ summary: 'Get all public invite links for a workspace' })
  @ApiResponse({ status: 200, description: 'Links retrieved successfully' })
  async getLinks(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return await this.workspaceService.getLinks(user.sub, id);
  }

  @Delete(':id/links/:linkId')
  @ApiOperation({ summary: 'Disable a public invite link' })
  @ApiResponse({ status: 200, description: 'Link disabled successfully' })
  async disableLink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.disableLink({
      workspaceId: id,
      linkId,
      adminUserId: user.sub,
    });
  }

  @Delete(':id/links/:linkId')
  @ApiOperation({ summary: 'Delete a public invite link' })
  @ApiResponse({ status: 200, description: 'Link deleted successfully' })
  async deleteLink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.workspaceService.deleteLink({
      workspaceId: id,
      linkId,
      adminUserId: user.sub,
    });
  }
}
