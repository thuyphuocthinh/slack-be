import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateCheckoutDto {
  @ApiProperty({ description: 'UUID của plan muốn đăng ký', example: 'uuid-v4' })
  @IsUUID('4', { message: 'planId phải là UUID hợp lệ' })
  planId: string;
}
