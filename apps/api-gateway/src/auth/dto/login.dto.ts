import { regex } from '@slack/constants';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'thuyphuocthinhtpt+5@gmail.com',
    description: 'User email address',
  })
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({
    example: '123456Aa',
    description:
      'User password, must contain at least 1 uppercase, 1 lowercase letter and be at least 8 characters long',
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
