import { Injectable, HttpStatus, Inject } from '@nestjs/common';
import { RpcException, ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { WORKSPACE_MESSAGE_PATTERNS, NAME_SERVICE_TCP, WorkspaceRoleEnum, AUTH_ERROR } from '@slack/constants';

@Injectable()
export class CalendarCommonService {
  constructor(
    @Inject(NAME_SERVICE_TCP.WORKSPACE_SERVICE)
    private readonly workspaceClient: ClientProxy,
  ) {}

  async fetchMember(workspaceId: string, userId: string) {
    const member = await firstValueFrom(
      this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER_DETAIL, { workspaceId, userId }),
    );
    if (!member) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...AUTH_ERROR.FORBIDDEN,
      });
    }
    const name = [member.firstName, member.lastName].filter(Boolean).join(' ') || 'Unknown User';
    return { ...member, name };
  }

  async getWorkspaceMembers(workspaceId: string, userId: string) {
    const members = await firstValueFrom(
      this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBERS, { workspaceId, userId }),
    );
    return members || [];
  }

  isPrivileged(role: string): boolean {
    return role === WorkspaceRoleEnum.ADMIN || role === WorkspaceRoleEnum.OWNER;
  }

  assertSelfOrPrivileged(requestorId: string, targetUserId: string, requestorRole: string): void {
    if (requestorId !== targetUserId && !this.isPrivileged(requestorRole)) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...AUTH_ERROR.FORBIDDEN,
      });
    }
  }

  assertPrivileged(role: string): void {
    if (!this.isPrivileged(role)) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...AUTH_ERROR.FORBIDDEN,
      });
    }
  }
}
