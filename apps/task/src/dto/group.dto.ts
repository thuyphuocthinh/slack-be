import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsOptional,
  IsNumber,
} from 'class-validator';

export class CreateGroupDto {
  @IsUUID()
  @IsNotEmpty()
  boardId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @IsOptional()
  order?: number;
}

export class UpdateGroupDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @IsOptional()
  order?: number;
}

export class GroupResponseDto {
  id: string;
  boardId: string;
  name: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}
