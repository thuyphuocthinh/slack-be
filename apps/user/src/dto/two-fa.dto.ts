import { IsNotEmpty, IsString } from 'class-validator';

export class GenerateSecretDto {
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class VerifyOTPDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  otp: string;
}

export class ToggleTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  userId: string;
}
