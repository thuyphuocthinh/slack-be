import {
  WorkspaceDto,
  WorkspaceMemberDto,
  WorkspaceInviteDto,
  WorkspaceLinkDto,
} from './workspace.dto';

export type WorkspaceResponseDto = WorkspaceDto;
export type WorkspaceMemberResponseDto = WorkspaceMemberDto;
export type WorkspaceMembersResponseDto = WorkspaceMemberDto[];
export type WorkspaceInviteResponseDto = WorkspaceInviteDto;
export type WorkspaceLinkResponseDto = WorkspaceLinkDto;

export class GenericResponseDto {
  message: string;
}
