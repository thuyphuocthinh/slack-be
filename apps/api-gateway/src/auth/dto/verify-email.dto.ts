import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Verification code (UUID) from email',
  })
  @IsString()
  @IsNotEmpty({ message: 'Verification code is required' })
  @IsUUID('7', { message: 'Invalid verification code format' })
  code: string;
}
