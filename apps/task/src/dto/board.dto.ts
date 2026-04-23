import { IsNotEmpty, IsString, IsUUID, IsOptional } from 'class-validator';

export class CreateBoardDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}

export class UpdateBoardDto {
  @IsString()
  @IsOptional()
  name?: string;
}

export class BoardResponseDto {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
