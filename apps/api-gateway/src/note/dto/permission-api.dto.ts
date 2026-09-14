import { IsIn, IsNotEmpty, IsUUID } from 'class-validator';

export class TogglePermissionApiDto {
  @IsUUID()
  @IsNotEmpty()
  targetUserId: string; // user được share/unshare — không phải người gọi API

  @IsIn(['view', 'edit'])
  type: string; // khớp giá trị enum PermissionType thật ở note microservice
}
