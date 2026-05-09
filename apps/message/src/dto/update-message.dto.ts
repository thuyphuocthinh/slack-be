import { IsArray, IsDefined, IsNotEmpty, IsOptional } from 'class-validator';

export class UpdateMessageDto {
  @IsDefined()
  @IsNotEmpty()
  content: string | Record<string, unknown>[];

  @IsArray()
  @IsOptional()
  mentions?: string[];
}
