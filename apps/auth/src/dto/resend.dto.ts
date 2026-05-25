import { VerificationAction } from '../entity/verification.entity';
import { IsEmail, IsIn, IsNotEmpty } from 'class-validator';

export class ResendCodeDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsIn([VerificationAction.VERIFY_EMAIL, VerificationAction.RESET_PASSWORD])
  action: VerificationAction;
}
