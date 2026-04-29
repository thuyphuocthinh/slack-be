import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity, UserStatus } from '../entity/user.entity';
import { ILike, In, Repository } from 'typeorm';
import { CreateUserDto, UpdateUserDto } from '../dto';
import { type IUserResponse } from '../types/user.response';
import { USER_ERROR } from '@slack/constants/errors/user.error';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { AUTH_MESSAGE_PATTERNS, NAME_SERVICE_TCP, DATABASE_ERROR } from '@slack/constants';
import { OptimisticLockVersionMismatchError } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { TwoFactorService } from './two_fa.service';
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @Inject(NAME_SERVICE_TCP.AUTH_SERVICE)
    private readonly authClient: ClientProxy,
    private readonly cachedService: CachedService,
    private readonly twoFactorService: TwoFactorService,
  ) {}

  private async mapUserToResponse(
    user: UserEntity,
    isTwoFactorEnabled?: boolean,
  ): Promise<IUserResponse> {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      systemRole: user.systemRole,
      status: user.status,
      isTwoFactorEnabled:
        isTwoFactorEnabled ?? (await this.isEnableTwoFactor(user.id)),
    };
  }

  async createUser(data: CreateUserDto): Promise<IUserResponse> {
    const user = this.userRepository.create(data);
    this.logger.log(`Creating user with email: ${data.email}`);
    const userSaved = await this.userRepository.save(user);
    // For new users, 2FA is always disabled by default
    return this.mapUserToResponse(userSaved, false);
  }

  async updateStatus(id: string, status: UserStatus): Promise<void> {
    const result = await this.userRepository.update({ id }, { status });

    if (result.affected === 0) {
      throw new RpcException(USER_ERROR.USER_NOT_FOUND);
    }

    this.logger.log(`Change status of user id ${id} to ${status}`);
  }

  async getUserById(id: string): Promise<IUserResponse> {
    const user = await this.cachedService.getOrSetDetail(
      CACHE.USER.KEYS.DETAIL(id),
      TTL.MEDIUM,
      () => this.userRepository.findOneBy({ id, status: UserStatus.ACTIVE }),
    );
    if (!user) {
      throw new RpcException(USER_ERROR.USER_NOT_FOUND);
    }
    return this.mapUserToResponse(user);
  }

  async getUserByEmail(email: string): Promise<IUserResponse> {
    const user = await this.cachedService.getOrSetDetail(
      CACHE.USER.KEYS.DETAIL(email), // Dùng email làm key phụ hoặc mapping
      TTL.MEDIUM,
      () =>
        this.userRepository.findOneBy({
          email,
          status: UserStatus.ACTIVE,
        }),
    );
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
    try {
      await this.userRepository.save(user);
      this.logger.log(`Change avatar of user id ${id}`);
      this.cachedService.invalidateDetail(CACHE.USER.KEYS.DETAIL(id));
      this.cachedService.invalidateDetail(CACHE.USER.KEYS.DETAIL(user.email));

      return this.getUserById(id);
    } catch (error) {
      if (error instanceof OptimisticLockVersionMismatchError) {
        throw new RpcException(DATABASE_ERROR.OPTIMISTIC_LOCK_CONFLICT);
      }
      throw error;
    }
  }

  // update info
  async updateInfo(id: string, data: UpdateUserDto): Promise<IUserResponse> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new RpcException(USER_ERROR.USER_NOT_FOUND);
    }

    if (data.firstName) user.firstName = data.firstName;
    if (data.lastName) user.lastName = data.lastName;

    try {
      await this.userRepository.save(user);
      this.logger.log(`Update info of user id ${id}`);
      this.cachedService.invalidateDetail(CACHE.USER.KEYS.DETAIL(id));
      this.cachedService.invalidateDetail(CACHE.USER.KEYS.DETAIL(user.email));

      return this.getUserById(id);
    } catch (error) {
      if (error instanceof OptimisticLockVersionMismatchError) {
        throw new RpcException(DATABASE_ERROR.OPTIMISTIC_LOCK_CONFLICT);
      }
      throw error;
    }
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
    return this.twoFactorService.isEnableTwoFactor(id);
  }

  async getBatchUserByIds(ids: string[]): Promise<IUserResponse[]> {
    const users = await this.userRepository.find({
      where: { id: In(ids), status: UserStatus.ACTIVE },
      select: [
        'id',
        'firstName',
        'lastName',
        'email',
        'avatarUrl',
        'status',
        'systemRole',
        'createdAt',
      ],
    });
    return Promise.all(users.map((user) => this.mapUserToResponse(user)));
  }

  async findUsersByEmail(email: string): Promise<IUserResponse[]> {
    const users = await this.userRepository.find({
      where: {
        email: ILike(`${email.toLowerCase()}%`),
        status: UserStatus.ACTIVE,
      },
      select: [
        'id',
        'firstName',
        'lastName',
        'email',
        'avatarUrl',
        'status',
        'systemRole',
        'createdAt',
      ],
    });
    return Promise.all(users.map((user) => this.mapUserToResponse(user)));
  }
}
