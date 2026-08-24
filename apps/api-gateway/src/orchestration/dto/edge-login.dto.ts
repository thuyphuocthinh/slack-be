import { IsNotEmpty, IsString } from 'class-validator';

export class EdgeLoginDto {
  @IsString()
  @IsNotEmpty()
  workspaceId: string;

  @IsString()
  @IsNotEmpty()
  clientSecret: string;
}
