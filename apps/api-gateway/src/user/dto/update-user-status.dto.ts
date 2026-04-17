import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
}

export class UpdateUserStatusDto {
  @ApiProperty({ example: 'active', description: 'User status' })
  @IsEnum(UserStatus, { message: 'Invalid user status' })
  @IsNotEmpty({ message: 'Status is required' })
  status: UserStatus;
}
