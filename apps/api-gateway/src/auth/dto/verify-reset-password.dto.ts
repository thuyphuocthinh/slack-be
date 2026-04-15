import { IsEmail, IsNotEmpty, IsString, IsUUID } from "class-validator";

export class VerifyResetPasswordDto {
    @IsEmail({}, { message: 'Invalid email format' })
    @IsNotEmpty({ message: 'Email is required' })
    email: string;

    @IsString({ message: 'Code must be a string' })
    @IsNotEmpty({ message: 'Code is required' })
    @IsUUID('7', { message: 'Invalid verification code format' })
    code: string;
}