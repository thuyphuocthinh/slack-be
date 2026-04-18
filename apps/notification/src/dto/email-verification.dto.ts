import { IsEmail, IsNotEmpty, IsObject, IsString } from 'class-validator';

export class EmailVerificationDto {
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Verification code is required' })
  code: string;
}

export class SendMailDto {
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email is required' })
  to: string;

  @IsString()
  @IsNotEmpty({ message: 'Subject is required' })
  subject: string;

  @IsString()
  @IsNotEmpty({ message: 'Template is required' })
  template: string;

  @IsObject()
  @IsNotEmpty({ message: 'Context is required' })
  context: Record<string, string>;
}
