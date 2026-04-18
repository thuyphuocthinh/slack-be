import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserSettingEntity } from '../entity/user_preference.entity';
import { Repository } from 'typeorm';
import { DEFAULT_USER_PREFERENCE } from '../constants/user_preference.constant';
import { UpdateUserSettingsDto } from '../dto';
import { deepMerge } from '@slack/common';
import { UserSettings } from '../types/user.setting';

@Injectable()
export class UserPreferenceService {
  constructor(
    @InjectRepository(UserSettingEntity)
    private readonly userPreferenceRepository: Repository<UserSettingEntity>,
  ) {}

  private mapEntityToResponse(entity: UserSettingEntity) {
    return entity.settings;
  }

  private async getOrCreate(userId: string): Promise<UserSettingEntity> {
    let userPreference = await this.userPreferenceRepository.findOne({
      where: { userId },
    });
    if (!userPreference) {
      userPreference = this.userPreferenceRepository.create({
        userId,
        settings: DEFAULT_USER_PREFERENCE,
      });
      userPreference = await this.userPreferenceRepository.save(userPreference);
    }
    return userPreference;
  }

  async getUserPreference(userId: string) {
    const userPreference = await this.getOrCreate(userId);
    return this.mapEntityToResponse(userPreference);
  }

  async updateUserPreference(
    userId: string,
    preference: UpdateUserSettingsDto,
  ) {
    const userPreference = await this.getOrCreate(userId);
    const mergedSettings = deepMerge<UserSettings>(
      userPreference.settings,
      preference as UserSettings,
    );
    userPreference.settings = mergedSettings;
    const updated = await this.userPreferenceRepository.save(userPreference);
    return this.mapEntityToResponse(updated);
  }
}
