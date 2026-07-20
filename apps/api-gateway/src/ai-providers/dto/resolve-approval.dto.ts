import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ResolveApprovalDto {
  // accuracy_problem.md mục 1 — 'clarify' dùng cho checkpoint kind='clarification'
  // (user vừa chọn 1 candidate agent), kèm selectedProvider bắt buộc khi đó.
  @IsIn(['approve', 'reject', 'clarify'])
  @IsNotEmpty()
  action: 'approve' | 'reject' | 'clarify';

  @IsOptional()
  @IsString()
  selectedProvider?: string;
}
