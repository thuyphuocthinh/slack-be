import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity, UserStatus } from '../entity/user.entity';
import { Repository } from 'typeorm';
import { CreateUserDto, UpdateUserDto } from '../dto';
import { type IUserResponse } from '../types/user.response';
import { USER_ERROR } from '@slack/constants/errors/user.error';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { AUTH_MESSAGE_PATTERNS, NAME_SERVICE_TCP } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { TwoFactorEntity } from '../entity/two_factor.entity';
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(TwoFactorEntity)
    private readonly twoFactorRepository: Repository<TwoFactorEntity>,
    @Inject(NAME_SERVICE_TCP.AUTH_SERVICE)
    private readonly authClient: ClientProxy,
  ) {}

  private mapUserToResponse(user: UserEntity): IUserResponse {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl,
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
      throw new RpcException(USER_ERROR.USER_NOT_FOUND);
    }
    user.status = status;
    this.logger.log(`Change status of user id ${id} to ${status}`);
    await this.userRepository.save(user);
  }

  async getUserById(id: string): Promise<IUserResponse> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new RpcException(USER_ERROR.USER_NOT_FOUND);
    }
    return this.mapUserToResponse(user);
  }

  async getUserByEmail(email: string): Promise<IUserResponse> {
    const user = await this.userRepository.findOneBy({ email });
    if (!user) {
      throw new RpcException(USER_ERROR.USER_NOT_FOUND);
    }
    return this.mapUserToResponse(user);
  }

  // change avatar (viet upload service truoc)
  async changeAvatar(id: string, avatarUrl: string): Promise<IUserResponse> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new RpcException(USER_ERROR.USER_NOT_FOUND);
    }
    user.avatarUrl = avatarUrl;
    await this.userRepository.save(user);
    this.logger.log(`Change avatar of user id ${id}`);
    return this.mapUserToResponse(user);
  }

  // update info
  async updateInfo(id: string, data: UpdateUserDto): Promise<IUserResponse> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new RpcException(USER_ERROR.USER_NOT_FOUND);
    }
    if (data.firstName) {
      user.firstName = data.firstName;
    }
    if (data.lastName) {
      user.lastName = data.lastName;
    }
    await this.userRepository.save(user);
    this.logger.log(`Update info of user id ${id}`);
    return this.mapUserToResponse(user);
  }

  // change password
  async changePassword(id: string, data: ChangePasswordDto): Promise<string> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new RpcException(USER_ERROR.USER_NOT_FOUND);
    }
    const { oldPassword, newPassword } = data;
    const isMatch = await firstValueFrom(
      this.authClient.send(AUTH_MESSAGE_PATTERNS.VERIFY_PASSWORD_FOR_UPDATE, {
        email: user.email,
        password: oldPassword,
      }),
    );
    if (!isMatch) {
      throw new RpcException(USER_ERROR.OLD_PASSWORD_NOT_MATCH);
    }
    const isSame = await firstValueFrom(
      this.authClient.send(AUTH_MESSAGE_PATTERNS.VERIFY_PASSWORD_FOR_UPDATE, {
        email: user.email,
        password: newPassword,
      }),
    );
    if (isSame) {
      throw new RpcException(USER_ERROR.INVALID_PASSWORD);
    }
    await firstValueFrom(
      this.authClient.send(AUTH_MESSAGE_PATTERNS.CHANGE_PASSWORD, {
        email: user.email,
        password: newPassword,
      }),
    );
    this.logger.log(`Change password of user id ${id}`);
    return 'Change password successfully';
  }

  async isEnableTwoFactor(id: string): Promise<boolean> {
    const twoFactor = await this.twoFactorRepository.findOneBy({ userId: id });
    return twoFactor?.enabled || false;
  }
}
