import { IsIn, IsNotEmpty } from 'class-validator';

export class ResolveApprovalDto {
  @IsIn(['approve', 'reject'])
  @IsNotEmpty()
  action: 'approve' | 'reject';
}
