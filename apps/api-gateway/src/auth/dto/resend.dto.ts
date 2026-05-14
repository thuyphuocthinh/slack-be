import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class ResendCodeDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    example: 'user@example.com',
    description: 'User email address',
  })
  email: string;

  @IsNotEmpty()
  @IsEnum(['verify_email', 'reset_password'])
  @ApiProperty({
    example: 'verify_email',
    description: 'Action type',
  })
  action: string;
}
