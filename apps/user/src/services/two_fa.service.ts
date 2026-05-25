import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TwoFactorEntity } from '../entity/two_factor.entity';
import { In, Repository } from 'typeorm';
import * as speakeasy from 'speakeasy';
import { RpcException } from '@nestjs/microservices';
import { TWO_FACTOR_ERROR } from '@slack/constants/errors/two_factor.error';
import { Logger } from '@nestjs/common';
import { CACHE, CachedService, TTL } from '@slack/cached';

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    @InjectRepository(TwoFactorEntity)
    private readonly twoFactorRepository: Repository<TwoFactorEntity>,
    private readonly cachedService: CachedService,
  ) {}

  async generateSecret(userId: string): Promise<string> {
    const secret = speakeasy.generateSecret({
      name: `Slack:${userId}`,
    });
    const existingTwoFactor = await this.twoFactorRepository.findOneBy({
      userId,
    });
    if (existingTwoFactor) {
      // if user already enabled two factor, throw error
      if (existingTwoFactor.enabled) {
        throw new RpcException(TWO_FACTOR_ERROR.TWO_FACTOR_ALREADY_ENABLED);
      } else {
        // update two factor secret if user generated but not initially verified authenticator yet
        await this.twoFactorRepository.update(existingTwoFactor.id, {
          secret: secret.base32,
          enabled: false,
        });
        this.logger.log(`User ${userId} regenerated two factor secret`);
        return secret.otpauth_url;
      }
    }
    await this.twoFactorRepository.save({
      userId,
      secret: secret.base32,
      enabled: false,
    });
    this.logger.log(`User ${userId} generated two factor secret`);
    return secret.otpauth_url;
  }

  async verifyOTP(userId: string, otp: string): Promise<boolean> {
    const twoFactor = await this.twoFactorRepository.findOneBy({ userId });
    if (!twoFactor) {
      throw new RpcException(TWO_FACTOR_ERROR.TWO_FACTOR_NOT_FOUND);
    }
    const verified = speakeasy.totp.verify({
      secret: twoFactor.secret,
      encoding: 'base32',
      token: otp,
    });
    if (!verified) {
      throw new RpcException(TWO_FACTOR_ERROR.TWO_FACTOR_INVALID_OTP);
    }
    await this.twoFactorRepository.update(twoFactor.id, {
      enabled: true,
    });
    this.logger.log(
      `Deleting cache for user ${userId}: ${CACHE.USER.KEYS.TWO_FACTOR(userId)}`,
    );
    await this.cachedService.del(CACHE.USER.KEYS.TWO_FACTOR(userId));
    this.cachedService.invalidateDetail(CACHE.USER.KEYS.DETAIL(userId));
    this.logger.log(`User ${userId} enabled two factor`);
    return verified;
  }

  async toggleTwoFactor(userId: string): Promise<boolean> {
    const twoFactor = await this.twoFactorRepository.findOneBy({ userId });
    if (!twoFactor) {
      throw new RpcException(TWO_FACTOR_ERROR.TWO_FACTOR_NOT_FOUND);
    }

    twoFactor.enabled = !twoFactor.enabled;
    await this.twoFactorRepository.save(twoFactor);

    await this.cachedService.del(CACHE.USER.KEYS.TWO_FACTOR(userId));
    this.cachedService.invalidateDetail(CACHE.USER.KEYS.DETAIL(userId));
    this.logger.log(
      `User ${userId} toggled two factor to ${twoFactor.enabled}`,
    );
    return twoFactor.enabled;
  }

  async isEnableTwoFactor(id: string): Promise<boolean> {
    const twoFactor = await this.cachedService.getOrSetDetail(
      CACHE.USER.KEYS.TWO_FACTOR(id),
      TTL.LONG,
      () => this.twoFactorRepository.findOneBy({ userId: id }),
    );
    this.logger.log(
      `Checking 2FA for user ${id}: ${twoFactor?.enabled || false}`,
    );
    return twoFactor?.enabled || false;
  }

  async getBatchTwoFactorStatus(
    ids: string[],
  ): Promise<Record<string, boolean>> {
    const twoFactors = await this.twoFactorRepository.find({
      where: { userId: In(ids) },
    });

    const statusMap: Record<string, boolean> = {};
    ids.forEach((id) => (statusMap[id] = false));
    twoFactors.forEach((tf) => {
      statusMap[tf.userId] = tf.enabled;
    });

    return statusMap;
  }
}
