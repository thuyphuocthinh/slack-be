import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyOtpFromAuthenticatorDto {
  @IsString()
  @IsNotEmpty({ message: 'Temp token is required' })
  tempToken: string;

  @IsString()
  @IsNotEmpty({ message: 'OTP is required' })
  otp: string;
}
