import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';

export class ChangeAvatarDto {
  @IsString({ message: 'User ID must be a string' })
  @IsNotEmpty({ message: 'User ID is required' })
  userId: string;

  @IsString({ message: 'Avatar URL must be a string' })
  @IsNotEmpty({ message: 'Avatar URL is required' })
  @IsUrl({}, { message: 'Invalid avatar URL' })
  @MaxLength(512, { message: 'Avatar URL must not exceed 512 characters' })
  avatarUrl: string;
}
