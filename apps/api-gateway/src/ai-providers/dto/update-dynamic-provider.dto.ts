import { PartialType } from '@nestjs/swagger';
import { RegisterDynamicProviderDto } from './register-dynamic-provider.dto';

// PATCH semantics — mọi field đều optional (kể cả name/specUrl vốn bắt buộc lúc đăng ký lần đầu).
// Để trống 1 field nghĩa là giữ nguyên giá trị cũ (xử lý ở DynamicProviderDbService.updateProvider).
export class UpdateDynamicProviderDto extends PartialType(
  RegisterDynamicProviderDto,
) {}
