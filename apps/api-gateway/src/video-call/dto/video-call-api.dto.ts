import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class JoinHuddleApiDto {
  @ApiProperty({
    description: 'ID của Channel hoặc Direct Message chứa phiên Huddle',
    example: '0bcda63b-d799-4771-bbfb-0c4e8c433e3b',
  })
  @IsUUID()
  @IsNotEmpty()
  channelId: string;
}

export class LeaveHuddleApiDto {
  @ApiProperty({
    description: 'ID của phiên Huddle đang tham gia',
    example: '0bcda63b-d799-4771-bbfb-0c4e8c433e3b',
  })
  @IsUUID()
  @IsNotEmpty()
  huddleId: string;
}
