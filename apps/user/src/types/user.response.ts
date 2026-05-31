import { UserStatus } from '../entity/user.entity';

export interface IUserResponse {
  id: string;
  email: string;
  systemRole: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  createdAt: Date;
  status: UserStatus;
  isTwoFactorEnabled: boolean;
  stripeCustomerId?: string;
}
