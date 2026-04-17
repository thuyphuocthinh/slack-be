import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateSecretDto {}

export class VerifyOTPDto {
  @ApiProperty({ example: '123456', description: 'OTP code' })
  @IsString()
  @IsNotEmpty()
  otp: string;
}

export class ToggleTwoFactorDto {}
