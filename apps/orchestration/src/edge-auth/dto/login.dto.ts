import { IsNotEmpty, IsString } from 'class-validator';

export class EdgeLoginDto {
  @IsString()
  @IsNotEmpty()
  workspaceId: string;

  @IsString()
  @IsNotEmpty()
  clientSecret: string;
}

export class EdgeLoginResponseDto {
  accessToken: string;
}
