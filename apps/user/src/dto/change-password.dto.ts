import { regex } from '@slack/constants';
import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'User id is required' })
  userId: string;

  @IsString()
  @IsNotEmpty({ message: 'Old password is required' })
  @MinLength(8, { message: 'Old password must be at least 8 characters' })
  @Matches(regex.password, {
    message:
      'Old password must contain at least 1 uppercase and 1 lowercase letter',
  })
  oldPassword: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(regex.password, {
    message:
      'Password must contain at least 1 uppercase and 1 lowercase letter',
  })
  newPassword: string;
}
