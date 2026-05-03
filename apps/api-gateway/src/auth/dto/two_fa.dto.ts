import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyOtpFromAuthenticatorDto {
  @IsString()
  @ApiProperty({
    example: 'temp-token-123',
    description: 'Temporary token for verification',
  })
  @IsNotEmpty({ message: 'Temp token is required' })
  tempToken: string;

  @IsString()
  @ApiProperty({
    example: '123456',
    description: 'One-Time Password',
  })
  @IsNotEmpty({ message: 'OTP is required' })
  otp: string;
}
