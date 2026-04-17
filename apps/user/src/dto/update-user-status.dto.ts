import { IsEnum, IsNotEmpty } from 'class-validator';
import { UserStatus } from '../entity/user.entity';

export class UpdateUserStatusDto {
  @IsNotEmpty({ message: 'User ID is required' })
  id: string;

  @IsEnum(UserStatus, { message: 'Status must be a valid UserStatus' })
  @IsNotEmpty({ message: 'Status is required' })
  status: UserStatus;
}
