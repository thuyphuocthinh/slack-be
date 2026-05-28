import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { WorkspaceService } from './services/workspace.service';
import { WorkspaceMemberService } from './services/workspace-member.service';
import { WorkspaceInviteService } from './services/workspace-invite.service';
import { WorkspaceLinkService } from './services/workspace-link.service';
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
  JoinLinkRequestDto,
  DisableLinkRequestDto,
  DeleteLinkRequestDto,
  UpdateWorkspaceRequestDto,
  AddBatchMembersRequestDto,
  GetWorkspacesRequestDto,
} from './dto/workspace-request.dto';
import { WorkspaceRoleEnum } from './types/workspace.enum';
import { AppService } from './services/app.service';
import {
  CreateAppRequestDto,
  UpdateAppRequestDto,
  DeleteAppRequestDto,
  GetAppsRequestDto,
} from './dto/app-request.dto';

@Controller()
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly memberService: WorkspaceMemberService,
    private readonly inviteService: WorkspaceInviteService,
    private readonly linkService: WorkspaceLinkService,
    private readonly appService: AppService,
  ) { }

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
    return this.memberService.getListMembersOfWorkspace(
      dto.workspaceId,
      dto.userId,
    );
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.INVITE_MEMBER)
  inviteMember(@Payload() dto: InviteMemberRequestDto) {
    return this.inviteService.inviteMember(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.REMOVE_MEMBER)
  removeMember(@Payload() dto: RemoveMemberRequestDto) {
    return this.memberService.removeMember(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.ACCEPT_INVITE)
  joinWorkspace(@Payload() dto: JoinWorkspaceRequestDto) {
    return this.inviteService.joinWorkspace(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.TRANSFER_OWNERSHIP)
  transferOwnership(@Payload() dto: TransferOwnershipRequestDto) {
    return this.memberService.transferOwnership(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.DELETE_WORKSPACE)
  deleteWorkspace(@Payload() dto: DeleteWorkspaceRequestDto) {
    return this.workspaceService.deleteWorkspace(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.ADD_MEMBER_DIRECT)
  addMember(@Payload() dto: AddMemberRequestDto) {
    return this.memberService.addMember(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.LEAVE)
  leaveWorkspace(@Payload() dto: LeaveWorkspaceRequestDto) {
    return this.memberService.leaveWorkspace(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.CHANGE_ROLE)
  changeRole(@Payload() dto: ChangeRoleRequestDto) {
    return this.memberService.changeRole(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.RESEND_INVITE)
  resendInvite(@Payload() dto: ResendInviteRequestDto) {
    return this.inviteService.resendInvite(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.REVOKE_INVITE)
  revokeInvite(@Payload() dto: RevokeInviteRequestDto) {
    return this.inviteService.revokeInvite(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.GET_WORKSPACES)
  getListWorkspaceOfUser(@Payload() dto: GetWorkspacesRequestDto) {
    return this.workspaceService.getListWorkspaceOfUser(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.CREATE_LINK)
  createLink(@Payload() dto: GenerateLinkRequestDto) {
    return this.linkService.generateLink(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.DISABLE_LINK)
  disableLink(@Payload() dto: DisableLinkRequestDto) {
    return this.linkService.disableLink(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.DELETE_LINK)
  deleteLink(@Payload() dto: DeleteLinkRequestDto) {
    return this.linkService.deleteLink(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.GET_LINKS)
  getLinks(@Payload() dto: { workspaceId: string; userId: string }) {
    return this.linkService.getLinks(dto.userId, dto.workspaceId);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.JOIN_LINK)
  joinLink(@Payload() dto: JoinLinkRequestDto) {
    return this.linkService.joinLink(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.ADD_BATCH_MEMBERS)
  addBatchMembers(@Payload() dto: AddBatchMembersRequestDto) {
    return this.memberService.addBatchMembers(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.CHECK_PERMISSION)
  checkPermission(
    @Payload()
    dto: {
      workspaceId: string;
      userId: string;
      allowedRoles: WorkspaceRoleEnum[];
    },
  ) {
    return this.workspaceService.checkPermission(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER)
  getMember(@Payload() dto: { workspaceId: string; userId: string }) {
    return this.memberService.getMemberByUserId(dto.workspaceId, dto.userId);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER_DETAIL)
  getMemberDetail(@Payload() dto: { workspaceId: string; userId: string }) {
    return this.memberService.getMemberDetail(dto.workspaceId, dto.userId);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.CREATE_APP)
  createApp(@Payload() dto: CreateAppRequestDto) {
    return this.appService.createApp(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.UPDATE_APP)
  updateApp(@Payload() dto: UpdateAppRequestDto) {
    return this.appService.updateApp(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.DELETE_APP)
  deleteApp(@Payload() dto: DeleteAppRequestDto) {
    return this.appService.deleteApp(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.GET_APPS)
  getApps(@Payload() dto: GetAppsRequestDto) {
    return this.appService.getApps(dto);
  }

  @MessagePattern(WORKSPACE_MESSAGE_PATTERNS.GET_APP_COMMANDS)
  getAppCommands(@Payload() dto: GetAppsRequestDto) {
    return this.appService.getAppCommands(dto);
  }
}
