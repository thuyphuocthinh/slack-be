import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { WorkspaceService } from './workspace.service';
import { WORKSPACE_MESSAGE_PATTERNS } from '@slack/constants';
import {
  CreateWorkspaceRequestDto,
  InviteMemberRequestDto,
  AddMemberRequestDto,
  RemoveMemberRequestDto,
  JoinWorkspaceRequestDto,
  LeaveWorkspaceRequestDto,
  ChangeRoleRequestDto,
  TransferOwnershipRequestDto,
  DeleteWorkspaceRequestDto,
  ResendInviteRequestDto,
  RevokeInviteRequestDto,
  GenerateLinkRequestDto,
  DisableLinkRequestDto,
  DeleteLinkRequestDto,
  UpdateWorkspaceRequestDto,
} from './dto/workspace-request.dto';

@Controller()
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.CREATE_WORKSPACE)
  createWorkspace(@Payload() dto: CreateWorkspaceRequestDto) {
    return this.workspaceService.createWorkspace(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.UPDATE_WORKSPACE)
  updateWorkspace(@Payload() dto: UpdateWorkspaceRequestDto) {
    return this.workspaceService.updateWorkspace(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.GET_WORKSPACE)
  getWorkspace(@Payload() dto: { workspaceId: string; userId: string }) {
    return this.workspaceService.getDetailWorkspace(
      dto.userId,
      dto.workspaceId,
    );
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBERS)
  getMembers(@Payload() dto: { workspaceId: string; userId: string }) {
    return this.workspaceService.getListMembersOfWorkspace(
      dto.workspaceId,
      dto.userId,
    );
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.INVITE_MEMBER)
  inviteMember(@Payload() dto: InviteMemberRequestDto) {
    return this.workspaceService.inviteMember(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.REMOVE_MEMBER)
  removeMember(@Payload() dto: RemoveMemberRequestDto) {
    return this.workspaceService.removeMember(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.ACCEPT_INVITE)
  joinWorkspace(@Payload() dto: JoinWorkspaceRequestDto) {
    return this.workspaceService.joinWorkspace(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.TRANSFER_OWNERSHIP)
  transferOwnership(@Payload() dto: TransferOwnershipRequestDto) {
    return this.workspaceService.transferOwnership(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.DELETE_WORKSPACE)
  deleteWorkspace(@Payload() dto: DeleteWorkspaceRequestDto) {
    return this.workspaceService.deleteWorkspace(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.ADD_MEMBER_DIRECT)
  addMember(@Payload() dto: AddMemberRequestDto) {
    return this.workspaceService.addMember(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.LEAVE)
  leaveWorkspace(@Payload() dto: LeaveWorkspaceRequestDto) {
    return this.workspaceService.leaveWorkspace(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.CHANGE_ROLE)
  changeRole(@Payload() dto: ChangeRoleRequestDto) {
    return this.workspaceService.changeRole(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.RESEND_INVITE)
  resendInvite(@Payload() dto: ResendInviteRequestDto) {
    return this.workspaceService.resendInvite(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.REVOKE_INVITE)
  revokeInvite(@Payload() dto: RevokeInviteRequestDto) {
    return this.workspaceService.revokeInvite(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.GET_WORKSPACES)
  getListWorkspaceOfUser(@Payload() userId: string) {
    return this.workspaceService.getListWorkspaceOfUser(userId);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.CREATE_LINK)
  createLink(@Payload() dto: GenerateLinkRequestDto) {
    return this.workspaceService.generateLink(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.DISABLE_LINK)
  disableLink(@Payload() dto: DisableLinkRequestDto) {
    return this.workspaceService.disableLink(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.DELETE_LINK)
  deleteLink(@Payload() dto: DeleteLinkRequestDto) {
    return this.workspaceService.deleteLink(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.GET_LINKS)
  getLinks(@Payload() dto: { workspaceId: string; userId: string }) {
    return this.workspaceService.getLinks(dto.userId, dto.workspaceId);
  }
}
