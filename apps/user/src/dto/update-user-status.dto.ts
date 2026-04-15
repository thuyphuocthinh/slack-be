import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';
import { UserStatus } from '../entity/user.entity';

export class UpdateUserStatusDto {
  @IsUUID('4', { message: 'Invalid user ID format' })
  @IsNotEmpty({ message: 'User ID is required' })
  id: string;

  @IsEnum(UserStatus, { message: 'Status must be a valid UserStatus' })
  @IsNotEmpty({ message: 'Status is required' })
  status: UserStatus;
}
