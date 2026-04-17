import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangeAvatarDto {
  @ApiProperty({
    example: 'https://example.com/avatar.jpg',
    description: 'Avatar URL',
  })
  @IsString({ message: 'Avatar URL must be a string' })
  @IsNotEmpty({ message: 'Avatar URL is required' })
  @IsUrl({}, { message: 'Invalid avatar URL' })
  @MaxLength(512, { message: 'Avatar URL must not exceed 512 characters' })
  avatarUrl: string;
}
