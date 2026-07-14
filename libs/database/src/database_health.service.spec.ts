import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DatabaseHealthService } from './database_health.service';

describe('DatabaseHealthService.isAlive (Backpressure/Admission control — health-check)', () => {
  let service: DatabaseHealthService;
  const mockDataSource = { query: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseHealthService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<DatabaseHealthService>(DatabaseHealthService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns true when the DB replies to a trivial query', async () => {
    mockDataSource.query.mockResolvedValue([{ test: 1 }]);

    await expect(service.isAlive()).resolves.toBe(true);
    expect(mockDataSource.query).toHaveBeenCalledWith('SELECT 1 as test');
  });

  it('returns false when the DB is unreachable, instead of throwing', async () => {
    mockDataSource.query.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(service.isAlive()).resolves.toBe(false);
  });
});
