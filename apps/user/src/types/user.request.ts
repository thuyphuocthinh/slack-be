import { UserStatus } from '../entity/user.entity';

export interface ICreateUserRequest {
  email: string;
}

export interface IUpdateUserStatusRequest {
  status: UserStatus;
  id: string;
}

export interface IUpdateUserRequest {
  fullName?: string;
  lastName?: string;
  avatarUrl?: string;
}
