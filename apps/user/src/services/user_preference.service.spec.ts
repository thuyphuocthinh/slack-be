import { Test, TestingModule } from '@nestjs/testing';
import { UserPreferenceService } from './user_preference.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserSettingEntity } from '../entity/user_preference.entity';
import { Repository } from 'typeorm';
import { DEFAULT_USER_PREFERENCE } from '../constants/user_preference.constant';

describe('UserPreferenceService', () => {
  let service: UserPreferenceService;
  let repository: Repository<UserSettingEntity>;

  const mockRepository = () => ({
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserPreferenceService,
        {
          provide: getRepositoryToken(UserSettingEntity),
          useFactory: mockRepository,
        },
      ],
    }).compile();

    service = module.get<UserPreferenceService>(UserPreferenceService);
    repository = module.get(getRepositoryToken(UserSettingEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserPreference', () => {
    const userId = 'user-id';

    it('should return existing preference', async () => {
      const existingPreference = {
        userId,
        settings: {
          ...DEFAULT_USER_PREFERENCE,
          ui: { ...DEFAULT_USER_PREFERENCE.ui, theme: 'dark' },
        },
      };
      (repository.findOne as jest.Mock).mockResolvedValue(existingPreference);

      const result = await service.getUserPreference(userId);

      expect(result).toEqual(existingPreference.settings);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { userId } });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should create and return default preference if not found', async () => {
      (repository.findOne as jest.Mock).mockResolvedValue(null);
      const newPreference = {
        userId,
        settings: DEFAULT_USER_PREFERENCE,
      };
      (repository.create as jest.Mock).mockReturnValue(newPreference);
      (repository.save as jest.Mock).mockResolvedValue(newPreference);

      const result = await service.getUserPreference(userId);

      expect(result).toEqual(DEFAULT_USER_PREFERENCE);
      expect(repository.create).toHaveBeenCalledWith({
        userId,
        settings: DEFAULT_USER_PREFERENCE,
      });
      expect(repository.save).toHaveBeenCalled();
    });
  });

  describe('updateUserPreference', () => {
    const userId = 'user-id';
    const updateDto = {
      ui: {
        theme: 'dark' as const,
      },
    };

    it('should merge and update preference successfully', async () => {
      const existingSettings = JSON.parse(
        JSON.stringify(DEFAULT_USER_PREFERENCE),
      );
      const existingPreference = {
        userId,
        settings: existingSettings,
      };

      (repository.findOne as jest.Mock).mockResolvedValue(existingPreference);
      (repository.save as jest.Mock).mockImplementation((pref) =>
        Promise.resolve(pref),
      );

      const result = await service.updateUserPreference(
        userId,
        updateDto as any,
      );

      expect(result.ui.theme).toBe('dark');
      expect(result.ui.language).toBe(DEFAULT_USER_PREFERENCE.ui.language); // Should keep other fields
      expect(repository.save).toHaveBeenCalled();
    });

    it('should create default then merge if preference not found', async () => {
      (repository.findOne as jest.Mock).mockResolvedValue(null);

      const newPreference = {
        userId,
        settings: JSON.parse(JSON.stringify(DEFAULT_USER_PREFERENCE)),
      };
      (repository.create as jest.Mock).mockReturnValue(newPreference);
      (repository.save as jest.Mock).mockImplementation((pref) =>
        Promise.resolve(pref),
      );

      const result = await service.updateUserPreference(
        userId,
        updateDto as any,
      );

      expect(result.ui.theme).toBe('dark');
      expect(repository.create).toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalled();
    });
  });
});
