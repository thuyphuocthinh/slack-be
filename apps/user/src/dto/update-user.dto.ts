import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Full name must not exceed 100 characters' })
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Last name must not exceed 100 characters' })
  lastName?: string;
}
