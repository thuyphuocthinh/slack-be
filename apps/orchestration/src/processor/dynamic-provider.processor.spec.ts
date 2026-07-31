import { Test, TestingModule } from '@nestjs/testing';
import { DynamicProviderProcessor } from './dynamic-provider.processor';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DynamicProviderEntity } from '../entity/dynamic-provider.entity';
import { EJobName } from '@slack/queue';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

describe('DynamicProviderProcessor', () => {
  let processor: DynamicProviderProcessor;
  let mockRepo: { update: jest.Mock };

  beforeEach(async () => {
    mockRepo = {
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamicProviderProcessor,
        {
          provide: getRepositoryToken(DynamicProviderEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    processor = module.get<DynamicProviderProcessor>(DynamicProviderProcessor);
    // Mock logger to keep test output clean
    processor.logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as unknown as Logger;
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process', () => {
    it('should handle UPDATE_DYNAMIC_PROVIDER_TOKEN job successfully without previousRefreshToken (legacy job)', async () => {
      const jobData = {
        providerId: 'test-provider-id',
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
      };

      const job = {
        name: EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN,
        data: jobData,
      } as Job;

      mockRepo.update.mockResolvedValue({ affected: 1 });

      await expect(processor.process(job)).resolves.not.toThrow();

      expect(mockRepo.update).toHaveBeenCalledWith('test-provider-id', {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenExpiresAt: jobData.tokenExpiresAt,
      });
      expect(processor.logger.log).toHaveBeenCalledWith(
        'Successfully persisted token for provider test-provider-id via Queue.',
      );
    });

    it('should scope the update to previousRefreshToken when present (CAS)', async () => {
      const jobData = {
        providerId: 'test-provider-id',
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
        previousRefreshToken: 'old-refresh-token',
      };

      const job = {
        name: EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN,
        data: jobData,
      } as Job;

      mockRepo.update.mockResolvedValue({ affected: 1 });

      await processor.process(job);

      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: 'test-provider-id', refreshToken: 'old-refresh-token' },
        {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          tokenExpiresAt: jobData.tokenExpiresAt,
        },
      );
    });

    it('should skip (not throw) when previousRefreshToken no longer matches — token already rotated by a newer job', async () => {
      const jobData = {
        providerId: 'test-provider-id',
        accessToken: 'stale-access-token',
        refreshToken: 'stale-refresh-token',
        previousRefreshToken: 'old-refresh-token',
      };

      const job = {
        name: EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN,
        data: jobData,
      } as Job;

      mockRepo.update.mockResolvedValue({ affected: 0 });

      await expect(processor.process(job)).resolves.not.toThrow();

      expect(processor.logger.warn).toHaveBeenCalledWith(
        'Skipped stale token write for provider test-provider-id — refreshToken already rotated by a newer update.',
      );
      expect(processor.logger.log).not.toHaveBeenCalled();
    });

    it('should throw an error if update fails, so BullMQ can retry', async () => {
      const jobData = {
        providerId: 'test-provider-id',
        accessToken: 'new-access-token',
      };

      const job = {
        name: EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN,
        data: jobData,
      } as Job;

      const dbError = new Error('Database connection failed');
      mockRepo.update.mockRejectedValue(dbError);

      await expect(processor.process(job)).rejects.toThrow(
        'Database connection failed',
      );

      expect(mockRepo.update).toHaveBeenCalledWith('test-provider-id', {
        accessToken: 'new-access-token',
        refreshToken: undefined,
        tokenExpiresAt: undefined,
      });
      expect(processor.logger.error).toHaveBeenCalledWith(
        'Failed to persist token for provider test-provider-id via Queue: Database connection failed',
        expect.any(String),
      );
    });

    it('should log a warning if job name is unknown', async () => {
      const job = {
        name: 'UNKNOWN_JOB_NAME' as any,
        data: {},
      } as Job;

      await processor.process(job);

      expect(processor.logger.warn).toHaveBeenCalledWith(
        'Unknown job name: UNKNOWN_JOB_NAME',
      );
      expect(mockRepo.update).not.toHaveBeenCalled();
    });
  });
});
