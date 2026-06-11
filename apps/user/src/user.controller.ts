import { Controller, Logger } from '@nestjs/common';
import { UserService } from './services/user.service';
import {
  ChangeAvatarDto,
  CreateUserDto,
  UpdateUserDto,
  UpdateUserSettingsDto,
  UpdateUserStatusDto,
} from './dto';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { USER_MESSAGE_PATTERNS } from '@slack/constants';
import { TWO_FA_MESSAGE_PATTERNS } from '@slack/constants/tcp/message_pattern/two_fa_pattern.constant';
import { TwoFactorService } from './services/two_fa.service';
import {
  ToggleTwoFactorDto,
  GenerateSecretDto,
  VerifyOTPDto,
} from './dto/two-fa.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserPreferenceService } from './services/user_preference.service';

@Controller()
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly userService: UserService,
    private readonly twoFactorService: TwoFactorService,
    private readonly userPreferenceService: UserPreferenceService,
  ) {}

  @MessagePattern(USER_MESSAGE_PATTERNS.CREATE_USER)
  async createUser(data: CreateUserDto) {
    return await this.userService.createUser(data);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.CHANGE_USER_STATUS)
  async changeStatus(data: UpdateUserStatusDto) {
    await this.userService.updateStatus(data.id, data.status);
    return { success: true };
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.GET_USER_BY_ID)
  async getUserById(data: { id: string }) {
    return await this.userService.getUserById(data.id);
  }

  @MessagePattern(TWO_FA_MESSAGE_PATTERNS.GENERATE_SECRET)
  async generateSecret(data: GenerateSecretDto) {
    return await this.twoFactorService.generateSecret(data.userId);
  }

  @MessagePattern(TWO_FA_MESSAGE_PATTERNS.VERIFY_OTP)
  async verifyOTP(data: VerifyOTPDto) {
    return await this.twoFactorService.verifyOTP(data.userId, data.otp);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.IS_USER_ENABLE_TWO_FACTOR)
  async isUserEnableTwoFactor(data: { userId: string }) {
    return await this.userService.isEnableTwoFactor(data.userId);
  }

  @MessagePattern(TWO_FA_MESSAGE_PATTERNS.TOGGLE_TWO_FACTOR)
  async toggleTwoFactor(data: ToggleTwoFactorDto) {
    return await this.twoFactorService.toggleTwoFactor(data.userId);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.CHANGE_AVATAR)
  async changeAvatar(data: ChangeAvatarDto) {
    return await this.userService.changeAvatar(data.userId, data.avatarUrl);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.UPDATE_INFO)
  async updateInfo(data: UpdateUserDto) {
    return await this.userService.updateInfo(data.userId, data);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.CHANGE_PASSWORD)
  async changePassword(data: ChangePasswordDto) {
    return await this.userService.changePassword(data.userId, data);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.GET_USER_PREFERENCE)
  async getUserPreference(data: { userId: string }) {
    return await this.userPreferenceService.getUserPreference(data.userId);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.UPDATE_USER_PREFERENCE)
  async updateUserPreference(data: {
    userId: string;
    preference: UpdateUserSettingsDto;
  }) {
    return await this.userPreferenceService.updateUserPreference(
      data.userId,
      data.preference,
    );
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.GET_BATCH_USER_BY_IDS)
  async getBatchUserByIds(data: { ids: string[] }) {
    return await this.userService.getBatchUserByIds(data.ids);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.GET_USER_BY_EMAIL)
  async getUserByEmail(data: { email: string }) {
    return await this.userService.getUserByEmail(data.email);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.FIND_USERS_BY_EMAIL)
  async findUsersByEmails(data: { email: string }) {
    this.logger.log(`Find users by email: ${data.email}`);
    return await this.userService.findUsersByEmail(data.email);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.DELETE_USER)
  async deleteUser(@Payload() data: { id: string }) {
    return await this.userService.deleteUser(data.id);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.UPDATE_USER_STRIPE_ID)
  async updateStripeCustomerId(@Payload() data: { id: string; stripeCustomerId: string }) {
    await this.userService.updateStripeCustomerId(data.id, data.stripeCustomerId);
    return { success: true };
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.GET_USER_BY_STRIPE_CUSTOMER_ID)
  async getUserByStripeCustomerId(@Payload() data: { stripeCustomerId: string }) {
    return await this.userService.getUserByStripeCustomerId(data.stripeCustomerId);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.SAVE_FCM_TOKEN)
  async saveFcmToken(@Payload() data: { userId: string; token: string; deviceId: string }) {
    await this.userService.saveFcmToken(data.userId, data.token, data.deviceId);
    return { success: true };
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.GET_USER_FCM_TOKENS)
  async getUserFcmTokens(@Payload() data: { userId: string }) {
    return await this.userService.getUserFcmTokens(data.userId);
  }
}
