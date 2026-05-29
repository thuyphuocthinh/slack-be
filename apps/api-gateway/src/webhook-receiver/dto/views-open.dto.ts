import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsString } from 'class-validator';

export class ViewsOpenDto {
  @ApiProperty({ description: 'The trigger ID to verify the modal request' })
  @IsString()
  @IsNotEmpty()
  trigger_id: string;

  @ApiProperty({ description: 'The view object to open' })
  @IsObject()
  @IsNotEmpty()
  view: any;
}
