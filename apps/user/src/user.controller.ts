import { Controller } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto, UpdateUserStatusDto } from './dto';
import { MessagePattern } from '@nestjs/microservices';
import { USER_MESSAGE_PATTERNS } from '@slack/constants';

@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @MessagePattern(USER_MESSAGE_PATTERNS.CREATE_USER)
  async createUser(data: CreateUserDto) {
    return await this.userService.createUser(data);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.CHANGE_USER_STATUS)
  async changeStatus(data: UpdateUserStatusDto) {
    await this.userService.updateStatus(data.id, data.status);
  }

  @MessagePattern(USER_MESSAGE_PATTERNS.GET_USER_BY_ID)
  async getUserById(data: { id: string }) {
    return await this.userService.getUserById(data.id);
  }
}
