import {
  WinstonModuleOptions,
  utilities as nestWinstonModuleUtilities,
} from 'nest-winston';
import * as winston from 'winston';
import LokiTransport from 'winston-loki';
import { TelegramTransport } from './telegram-transport';

export const getLoggerConfig = (appName: string): WinstonModuleOptions => {
  const transports: winston.transport[] = [
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
  ];

  if (process.env.LOKI_ENABLED === 'true') {
    transports.push(
      new LokiTransport({
        host: process.env.LOKI_HOST || 'http://localhost:3100',
        labels: { application: appName.toLowerCase() },
        json: true,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
        replaceTimestamp: true,
        onConnectionError: (err) => {
          console.error(`[Winston Loki] Connection error for ${appName}:`, err);
        },
      }),
    );
  }

  if (process.env.TELEGRAM_ALERT_ENABLED === 'true') {
    transports.push(
      new TelegramTransport({
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format((info) => {
            info.appName = appName;
            return info;
          })(),
        ),
      }) as any,
    );
  }

  return {
    transports,
  };
};

