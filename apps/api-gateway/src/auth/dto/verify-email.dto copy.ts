import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty({ message: 'Verification code is required' })
  @IsUUID('7', { message: 'Invalid verification code format' })
  code: string;
}
