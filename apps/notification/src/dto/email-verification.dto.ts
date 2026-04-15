import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class EmailVerificationDto {
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Verification code is required' })
  code: string;
}
