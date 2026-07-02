import { IsObject, IsNotEmpty } from 'class-validator';

export class SubmitProviderCredentialsDto {
  @IsObject()
  @IsNotEmpty()
  credentials: Record<string, string>;
}
