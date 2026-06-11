import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  NAME_SERVICE_TCP,
  TWO_FA_MESSAGE_PATTERNS,
  USER_MESSAGE_PATTERNS,
} from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
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
  ) {}

  async updateInfo(id: string, data: UpdateUserDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.userClient.send(USER_MESSAGE_PATTERNS.UPDATE_INFO, {
            ...data,
            userId: id,
          }),
        ),
      'updateInfo',
      'UserService',
    );
  }

  async changeAvatar(id: string, data: ChangeAvatarDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.userClient.send(USER_MESSAGE_PATTERNS.CHANGE_AVATAR, {
            ...data,
            userId: id,
          }),
        ),
      'changeAvatar',
      'UserService',
    );
  }

  async changeStatus(id: string, data: UpdateUserStatusDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.userClient.send(USER_MESSAGE_PATTERNS.CHANGE_USER_STATUS, {
            ...data,
            id: id,
          }),
        ),
      'changeStatus',
      'UserService',
    );
  }

  async getUserById(id: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, { id }),
        ),
      'getUserById',
      'UserService',
    );
  }

  async changePassword(id: string, data: ChangePasswordDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.userClient.send(USER_MESSAGE_PATTERNS.CHANGE_PASSWORD, {
            ...data,
            userId: id,
          }),
        ),
      'changePassword',
      'UserService',
    );
  }

  async toggleTwoFactor(id: string, data: ToggleTwoFactorDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.userClient.send(TWO_FA_MESSAGE_PATTERNS.TOGGLE_TWO_FACTOR, {
            ...data,
            userId: id,
          }),
        ),
      'toggleTwoFactor',
      'UserService',
    );
  }

  async generateSecret(id: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.userClient.send(TWO_FA_MESSAGE_PATTERNS.GENERATE_SECRET, {
            userId: id,
          }),
        ),
      'generateSecret',
      'UserService',
    );
  }

  async verifyTwoFactor(id: string, data: VerifyOTPDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.userClient.send(TWO_FA_MESSAGE_PATTERNS.VERIFY_OTP, {
            ...data,
            userId: id,
          }),
        ),
      'verifyTwoFactor',
      'UserService',
    );
  }

  async getUserPreference(id: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_PREFERENCE, {
            userId: id,
          }),
        ),
      'getUserPreference',
      'UserService',
    );
  }

  async updateUserPreference(id: string, data: UpdateUserSettingsDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.userClient.send(USER_MESSAGE_PATTERNS.UPDATE_USER_PREFERENCE, {
            userId: id,
            preference: data,
          }),
        ),
      'updateUserPreference',
      'UserService',
    );
  }

  async findUsersByEmail(email: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.userClient.send(USER_MESSAGE_PATTERNS.FIND_USERS_BY_EMAIL, {
            email,
          }),
        ),
      'findUsersByEmail',
      'UserService',
    );
  }

  async saveFcmToken(userId: string, token: string, deviceId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.userClient.send(USER_MESSAGE_PATTERNS.SAVE_FCM_TOKEN, {
            userId,
            token,
            deviceId,
          }),
        ),
      'saveFcmToken',
      'UserService',
    );
  }
}
