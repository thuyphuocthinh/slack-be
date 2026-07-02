import { SystemRoleEnum } from '@slack/constants';

export interface UserType {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string;
  systemRole: SystemRoleEnum;
  isBot?: boolean;
}
