import { regex } from '@slack/constants';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @IsString({ message: 'Code must be a string' })
  @IsNotEmpty({ message: 'Code is required' })
  @IsUUID('7', { message: 'Invalid verification code format' })
  code: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(regex.password, {
    message:
      'Password must contain at least 1 uppercase and 1 lowercase letter',
  })
  password: string;
}
