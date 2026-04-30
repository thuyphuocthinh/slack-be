import { IsBoolean, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UIPreferenceDto {
  @IsOptional()
  @IsEnum(['light', 'dark'])
  theme?: 'light' | 'dark';

  @IsOptional()
  @IsEnum(['vi', 'en'])
  language?: 'vi' | 'en';

  @IsOptional()
  @IsEnum(['comfortable', 'compact'])
  density?: 'comfortable' | 'compact';
}

export class NotificationPreferenceDto {
  @IsOptional()
  @IsBoolean()
  desktop?: boolean;

  @IsOptional()
  @IsBoolean()
  mentionOnly?: boolean;
}

export class MessagingPreferenceDto {
  @IsOptional()
  @IsBoolean()
  enterToSend?: boolean;

  @IsOptional()
  @IsBoolean()
  showPreview?: boolean;
}

export class PrivacyPreferenceDto {
  @IsOptional()
  @IsEnum(['everyone', 'members', 'none'])
  allowDmFrom?: 'everyone' | 'members' | 'none';
}

export class UpdateUserSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UIPreferenceDto)
  ui?: UIPreferenceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPreferenceDto)
  notification?: NotificationPreferenceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MessagingPreferenceDto)
  messaging?: MessagingPreferenceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PrivacyPreferenceDto)
  privacy?: PrivacyPreferenceDto;
}
