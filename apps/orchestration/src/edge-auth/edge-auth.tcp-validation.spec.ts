import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ClientProxy,
  ClientsModule,
  MicroserviceOptions,
  Transport,
} from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { ORCHESTRATION_MESSAGE_PATTERNS } from '@slack/constants';
import { AllRpcExceptionFilter } from '@slack/common';
import { EdgeAuthModule } from './edge-auth.module';

// Root cause thật (đã verify thực nghiệm): app hybrid (main.ts) cần
// connectMicroservice(options, { inheritAppConfig: true }) thì global
// ValidationPipe/AllRpcExceptionFilter mới áp dụng cho nhánh TCP — thiếu cờ
// này thì microservice chạy context riêng, phớt lờ mọi global enhancer.
describe('EdgeAuthController TCP @MessagePattern — ValidationPipe enforcement (mirrors main.ts)', () => {
  let app: INestApplication;
  let client: ClientProxy;
  const port = 41500 + Math.floor(Math.random() * 5000);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        EdgeAuthModule,
        ClientsModule.register([
          {
            name: 'TEST_CLIENT',
            transport: Transport.TCP,
            options: { port },
          },
        ]),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllRpcExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: false,
        forbidNonWhitelisted: false,
      }),
    );
    app.connectMicroservice<MicroserviceOptions>(
      { transport: Transport.TCP, options: { port } },
      { inheritAppConfig: true },
    );
    await app.startAllMicroservices();
    await app.init();

    client = app.get<ClientProxy>('TEST_CLIENT');
    await client.connect();
  });

  afterAll(async () => {
    client.close();
    await app.close();
  });

  it('rejects a payload missing clientSecret with a clean validation message, never reaching EdgeAuthService', async () => {
    process.env.EDGE_RELAY_SECRETS = JSON.stringify({});

    await expect(
      firstValueFrom(
        client.send(ORCHESTRATION_MESSAGE_PATTERNS.EDGE_RELAY_LOGIN, {
          workspaceId: 'ws-1',
        }),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('clientSecret'),
    });
  });

  it('reaches EdgeAuthService (domain error, not a validation error) for a well-formed payload', async () => {
    process.env.EDGE_RELAY_SECRETS = JSON.stringify({});

    await expect(
      firstValueFrom(
        client.send(ORCHESTRATION_MESSAGE_PATTERNS.EDGE_RELAY_LOGIN, {
          workspaceId: 'ws-1',
          clientSecret: 'whatever',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'ERR.ORCHESTRATION.0120',
    });
  });
});
