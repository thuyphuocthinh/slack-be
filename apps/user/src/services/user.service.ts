import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity, UserStatus } from '../entity/user.entity';
import { UserFcmTokenEntity } from '../entity/user_fcm_token.entity';
import { ILike, In, Repository } from 'typeorm';
import { CreateUserDto, UpdateUserDto } from '../dto';
import { type IUserResponse } from '../types/user.response';
import { USER_ERROR } from '@slack/constants/errors/user.error';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { ChangePasswordDto } from '../dto/change-password.dto';
import {
  AUTH_MESSAGE_PATTERNS,
  NAME_SERVICE_TCP,
  DATABASE_ERROR,
} from '@slack/constants';
import { OptimisticLockVersionMismatchError } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { CACHE, CachedService, TTL, AuthCacheService } from '@slack/cached';
import { TwoFactorService } from './two_fa.service';
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(UserFcmTokenEntity)
    private readonly userFcmTokenRepository: Repository<UserFcmTokenEntity>,
    @Inject(NAME_SERVICE_TCP.AUTH_SERVICE)
    private readonly authClient: ClientProxy,
    private readonly cachedService: CachedService,
    private readonly twoFactorService: TwoFactorService,
    private readonly authCacheService: AuthCacheService,
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
      stripeCustomerId: user.stripeCustomerId,
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

    // Invalidate user detail cache
    this.cachedService.invalidateDetail(CACHE.USER.KEYS.DETAIL(id));

    // If user is deactivated/inactive, bump token version to invalidate all active sessions
    if (status === UserStatus.INACTIVE) {
      await this.authCacheService.bumpUserTokenVersion(id);
      this.logger.log(`Bumped token version for user ${id} due to inactive status`);
    }
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
    const response = await this.mapUserToResponse(user);
    this.logger.log(
      `User ${email} response 2FA: ${response.isTwoFactorEnabled}`,
    );
    return response;
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

    const twoFaStatuses = await this.twoFactorService.getBatchTwoFactorStatus(
      users.map((u) => u.id),
    );

    return users.map((user) => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      systemRole: user.systemRole,
      status: user.status,
      isTwoFactorEnabled: twoFaStatuses[user.id] || false,
    }));
  }

  async findUsersByEmail(email: string): Promise<IUserResponse[]> {
    return await this.cachedService.getOrSetList({
      trackerKey: CACHE.USER.TRACKERS.LIST_VERSION,
      keyBuilder: (version) => CACHE.USER.KEYS.SEARCH(email, version),
      ttl: TTL.SHORT,
      fetcher: async () => {
        this.logger.log(`Finding users with email: ${email}`);
        const users = await this.userRepository.find({
          where: {
            email: ILike(`${email}%`),
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

        const twoFaStatuses =
          await this.twoFactorService.getBatchTwoFactorStatus(
            users.map((u) => u.id),
          );

        return users.map((user) => ({
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          avatarUrl: user.avatarUrl,
          createdAt: user.createdAt,
          systemRole: user.systemRole,
          status: user.status,
          isTwoFactorEnabled: twoFaStatuses[user.id] || false,
        }));
      },
    });
  }

  async deleteUser(id: string): Promise<void> {
    const result = await this.userRepository.delete(id);
    if (result.affected === 0) {
      throw new RpcException(USER_ERROR.USER_NOT_FOUND);
    }
    this.logger.log(`Deleted user id ${id}`);
    this.cachedService.invalidateDetail(CACHE.USER.KEYS.DETAIL(id));
  }

  async updateStripeCustomerId(id: string, stripeCustomerId: string): Promise<void> {
    const result = await this.userRepository.update({ id }, { stripeCustomerId });
    if (result.affected === 0) {
      throw new RpcException(USER_ERROR.USER_NOT_FOUND);
    }
    this.logger.log(`Updated stripeCustomerId for user id ${id}`);
    this.cachedService.invalidateDetail(CACHE.USER.KEYS.DETAIL(id));
  }

  async getUserByStripeCustomerId(stripeCustomerId: string): Promise<IUserResponse> {
    const user = await this.userRepository.findOne({
      where: { stripeCustomerId, status: UserStatus.ACTIVE },
    });
    if (!user) {
      throw new RpcException(USER_ERROR.USER_NOT_FOUND);
    }
    return this.mapUserToResponse(user);
  }

  async saveFcmToken(userId: string, token: string, deviceId: string): Promise<void> {
    this.logger.log(`Saving FCM token for user ${userId} and device ${deviceId}`);
    let userFcmToken = await this.userFcmTokenRepository.findOneBy({ userId, deviceId });
    if (userFcmToken) {
      userFcmToken.token = token;
    } else {
      userFcmToken = this.userFcmTokenRepository.create({ userId, deviceId, token });
    }
    await this.userFcmTokenRepository.save(userFcmToken);
  }

  async getUserFcmTokens(userId: string): Promise<string[]> {
    const tokens = await this.userFcmTokenRepository.find({
      where: { userId },
      select: ['token'],
    });
    return tokens.map((t) => t.token);
  }
}
