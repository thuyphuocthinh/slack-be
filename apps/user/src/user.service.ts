import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity, UserStatus } from './entity/user.entity';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto';
import { type IUserResponse } from './types/user.response';
import { USER_ERROR } from '@slack/constants/errors/user.error';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  private mapUserToResponse(user: UserEntity): IUserResponse {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      createdAt: user.createdAt,
      systemRole: user.systemRole,
      status: user.status,
    };
  }

  async createUser(data: CreateUserDto): Promise<IUserResponse> {
    const user = this.userRepository.create(data);
    this.logger.log(`Creating user with email: ${data.email}`);
    const userSaved = await this.userRepository.save(user);
    return this.mapUserToResponse(userSaved);
  }

  async updateStatus(id: string, status: UserStatus): Promise<void> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new BadRequestException(USER_ERROR.USER_NOT_FOUND);
    }
    user.status = status;
    this.logger.log(`Change status of user id ${id} to ${status}`);
    await this.userRepository.save(user);
  }

  async getUserById(id: string): Promise<IUserResponse> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new BadRequestException(USER_ERROR.USER_NOT_FOUND);
    }
    return this.mapUserToResponse(user);
  }
}
