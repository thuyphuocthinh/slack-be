import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { UserService } from './user.service';
import {
  ChangeAvatarDto,
  UpdateUserDto,
  UpdateUserSettingsDto,
  UpdateUserStatusDto,
} from './dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ToggleTwoFactorDto, VerifyOTPDto } from './dto/two-fa.dto';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentUser, type JwtUser } from '@slack/common';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @ApiOperation({ summary: 'Update user info' })
  @ApiResponse({ status: 200, description: 'User info updated successfully' })
  @Patch('me/update-info')
  async updateInfo(@Body() data: UpdateUserDto, @CurrentUser() user: JwtUser) {
    return await this.userService.updateInfo(user.sub, data);
  }

  @ApiOperation({ summary: 'Change user avatar' })
  @ApiResponse({ status: 200, description: 'User avatar changed successfully' })
  @Patch('me/change-avatar')
  async changeAvatar(
    @Body() data: ChangeAvatarDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.userService.changeAvatar(user.sub, data);
  }

  @ApiOperation({ summary: 'Change user status' })
  @ApiResponse({ status: 200, description: 'User status changed successfully' })
  @Patch('me/change-status')
  async changeStatus(
    @Body() data: UpdateUserStatusDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.userService.changeStatus(user.sub, data);
  }

  @ApiOperation({ summary: 'Get user by id' })
  @ApiResponse({ status: 200, description: 'User info retrieved successfully' })
  @Get('me')
  async getUserById(@CurrentUser() user: JwtUser) {
    return await this.userService.getUserById(user.sub);
  }

  @ApiOperation({ summary: 'Change user password' })
  @ApiResponse({
    status: 200,
    description: 'User password changed successfully',
  })
  @Patch('me/change-password')
  async changePassword(
    @Body() data: ChangePasswordDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.userService.changePassword(user.sub, data);
  }

  @ApiOperation({ summary: 'Toggle two factor authentication' })
  @ApiResponse({
    status: 200,
    description: 'Two factor authentication toggled successfully',
  })
  @Patch('me/two-factor/toggle')
  async toggleTwoFactor(
    @Body() data: ToggleTwoFactorDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.userService.toggleTwoFactor(user.sub, data);
  }

  @ApiOperation({ summary: 'Generate two factor secret' })
  @ApiResponse({
    status: 200,
    description: 'Two factor secret generated successfully',
  })
  @Get('me/two-factor/generate-secret')
  async generateSecret(@CurrentUser() user: JwtUser) {
    return await this.userService.generateSecret(user.sub);
  }

  @ApiOperation({ summary: 'Verify two factor authentication' })
  @ApiResponse({
    status: 200,
    description: 'Two factor authentication verified successfully',
  })
  @Post('me/two-factor/verify')
  async verifyTwoFactor(
    @Body() data: VerifyOTPDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.userService.verifyTwoFactor(user.sub, data);
  }

  @ApiOperation({ summary: 'Get user preference' })
  @ApiResponse({
    status: 200,
    description: 'User preference retrieved successfully',
  })
  @Get('me/preference')
  async getUserPreference(@CurrentUser() user: JwtUser) {
    return await this.userService.getUserPreference(user.sub);
  }

  @ApiOperation({ summary: 'Update user preference' })
  @ApiResponse({
    status: 200,
    description: 'User preference updated successfully',
  })
  @Patch('me/preference')
  async updateUserPreference(
    @Body() data: UpdateUserSettingsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.userService.updateUserPreference(user.sub, data);
  }
}
