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
  @IsEnum(['VERIFY_EMAIL', 'RESET_PASSWORD'])
  @ApiProperty({
    example: 'VERIFY_EMAIL',
    description: 'Action type',
  })
  action: string;
}
