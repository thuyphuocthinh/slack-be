import { Transport, ClientsProviderAsyncOptions } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';

/**
 * Generates an async configuration option for ClientsModule to dynamically connect
 * to TCP microservices using environment variables or fallback values.
 *
 * @param serviceName Name of the microservice (e.g. NAME_SERVICE_TCP.WORKSPACE_SERVICE)
 * @param defaultPort Default port if no environment variable is provided
 */
export function getMicroserviceClientConfig(
  serviceName: string,
  defaultPort: number,
): ClientsProviderAsyncOptions {
  return {
    name: serviceName,
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (configService: ConfigService) => {
      // E.g. WORKSPACE_SERVICE -> WORKSPACE_SERVICE_HOST and WORKSPACE_SERVICE_PORT
      const hostEnvKey = `${serviceName}_HOST`;
      const portEnvKey = `${serviceName}_PORT`;

      return {
        transport: Transport.TCP,
        options: {
          host: configService.get<string>(hostEnvKey, 'localhost'),
          port: configService.get<number>(portEnvKey, defaultPort),
        },
      };
    },
  };
}
