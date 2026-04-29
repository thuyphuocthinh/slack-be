import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  NAME_SERVICE_TCP,
  TWO_FA_MESSAGE_PATTERNS,
  USER_MESSAGE_PATTERNS,
} from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import {
  ChangeAvatarDto,
  UpdateUserDto,
  UpdateUserSettingsDto,
  UpdateUserStatusDto,
} from './dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ToggleTwoFactorDto, VerifyOTPDto } from './dto/two-fa.dto';

@Injectable()
export class UserService {
  constructor(
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
  ) { }

  async updateInfo(id: string, data: UpdateUserDto) {
    return await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.UPDATE_INFO, {
        ...data,
        userId: id,
      }),
    );
  }

  async changeAvatar(id: string, data: ChangeAvatarDto) {
    return await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.CHANGE_AVATAR, {
        ...data,
        userId: id,
      }),
    );
  }

  async changeStatus(id: string, data: UpdateUserStatusDto) {
    return await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.CHANGE_USER_STATUS, {
        ...data,
        id: id,
      }),
    );
  }

  async getUserById(id: string) {
    return await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, { id }),
    );
  }

  async changePassword(id: string, data: ChangePasswordDto) {
    return await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.CHANGE_PASSWORD, {
        ...data,
        userId: id,
      }),
    );
  }

  async toggleTwoFactor(id: string, data: ToggleTwoFactorDto) {
    return await firstValueFrom(
      this.userClient.send(TWO_FA_MESSAGE_PATTERNS.TOGGLE_TWO_FACTOR, {
        ...data,
        userId: id,
      }),
    );
  }

  async generateSecret(id: string) {
    return await firstValueFrom(
      this.userClient.send(TWO_FA_MESSAGE_PATTERNS.GENERATE_SECRET, {
        userId: id,
      }),
    );
  }

  async verifyTwoFactor(id: string, data: VerifyOTPDto) {
    return await firstValueFrom(
      this.userClient.send(TWO_FA_MESSAGE_PATTERNS.VERIFY_OTP, {
        ...data,
        userId: id,
      }),
    );
  }

  async getUserPreference(id: string) {
    return await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_PREFERENCE, {
        userId: id,
      }),
    );
  }

  async updateUserPreference(id: string, data: UpdateUserSettingsDto) {
    return await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.UPDATE_USER_PREFERENCE, {
        userId: id,
        preference: data,
      }),
    );
  }

  async findUsersByEmail(emails: string) {
    return await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.FIND_USERS_BY_EMAIL, {
        emails,
      }),
    );
  }
}
