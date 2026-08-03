import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { EApprovalAction } from '@slack/constants';

export class ResolveApprovalDto {
  @IsIn(['approve', 'reject', 'clarify', 'edit_and_approve'])
  @IsNotEmpty()
  action: EApprovalAction;

  @IsOptional()
  @IsString()
  selectedProvider?: string;

  @IsOptional()
  editedArgs?: Record<string, any>;
}
