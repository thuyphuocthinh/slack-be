import { regex } from '@slack/constants';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'User email address',
  })
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Verification code (UUID)',
  })
  @IsString({ message: 'Code must be a string' })
  @IsNotEmpty({ message: 'Code is required' })
  @IsUUID('7', { message: 'Invalid verification code format' })
  code: string;

  @ApiProperty({
    example: 'NewPassword123!',
    description:
      'New user password, must contain at least 1 uppercase, 1 lowercase letter and be at least 8 characters long',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(regex.password, {
    message:
      'Password must contain at least 1 uppercase and 1 lowercase letter',
  })
  password: string;
}
