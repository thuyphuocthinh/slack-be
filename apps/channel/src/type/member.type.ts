import { SystemRoleEnum } from '@slack/constants';

export interface MemberType {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatarUrl: string;
    systemRole: SystemRoleEnum;
}
