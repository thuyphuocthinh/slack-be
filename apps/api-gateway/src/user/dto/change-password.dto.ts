import { regex } from '@slack/constants';
import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: '123456Aa', description: 'Old password' })
  @IsString()
  @IsNotEmpty({ message: 'Old password is required' })
  @MinLength(8, { message: 'Old password must be at least 8 characters' })
  @Matches(regex.password, {
    message:
      'Old password must contain at least 1 uppercase and 1 lowercase letter',
  })
  oldPassword: string;

  @ApiProperty({ example: '123456Aa', description: 'New password' })
  @IsString()
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, { message: 'New password must be at least 8 characters' })
  @Matches(regex.password, {
    message:
      'New password must contain at least 1 uppercase and 1 lowercase letter',
  })
  newPassword: string;
}
