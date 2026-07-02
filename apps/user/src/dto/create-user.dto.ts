import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { UserStatus } from '../entity/user.entity';

export class CreateUserDto {
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @IsEnum(UserStatus)
  @IsNotEmpty({ message: 'Status is required' })
  status: UserStatus;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsBoolean()
  @IsOptional()
  isBot?: boolean;
}
