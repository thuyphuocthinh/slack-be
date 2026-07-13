import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class RegisterDynamicProviderDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  specUrl: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  accessToken?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  authType?: string;

  // OAUTH2 only — thiếu refreshToken hoặc tokenUrl thì backend sẽ không bao giờ tự refresh được.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  tokenUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  clientSecret?: string;

  @ApiProperty({ required: false, enum: ['form', 'json'] })
  @IsOptional()
  @IsIn(['form', 'json'])
  refreshRequestFormat?: 'form' | 'json';

  // Escape hatch — chỉ cần khi response làm mới token của hệ thống nội bộ quá khác biệt so với
  // chuẩn (server đã tự thử snake_case/camelCase/envelope 1 lớp trước khi cần tới các field này).
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  responseAccessTokenPath?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  responseRefreshTokenPath?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  responseExpiresInPath?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  defaultExpiresInSecs?: number;
}
