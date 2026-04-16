import {
  WinstonModuleOptions,
  utilities as nestWinstonModuleUtilities,
} from 'nest-winston';
import * as winston from 'winston';
import LokiTransport from 'winston-loki';

export const getLoggerConfig = (appName: string): WinstonModuleOptions => {
  return {
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.ms(),
          nestWinstonModuleUtilities.format.nestLike(appName, {
            colors: true,
            prettyPrint: true,
            processId: true,
            appName: true,
          }),
        ),
      }),
      new LokiTransport({
        host: 'http://localhost:3100', // Update to your Loki server URL if deployed
        labels: { application: appName },
        json: true,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
        replaceTimestamp: true,
        onConnectionError: (err) => console.error(err),
      }),
    ],
  };
};
