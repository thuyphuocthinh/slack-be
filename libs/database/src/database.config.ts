import { DataSourceOptions } from 'typeorm';
import { join } from 'path';

export const getDataSourceOptions = (): DataSourceOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5434', 10),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  synchronize: false,
  logging: ['error'],
  entities: [
    join(process.cwd(), 'apps/**/*.entity.{js,ts}'),
    join(process.cwd(), 'libs/**/*.entity.{js,ts}'),
  ],
  migrations: [join(process.cwd(), 'apps/**/migrations/**/*.{js,ts}')],
  extra: {
    max: 25, // Reduce max connections per service to avoid Postgres 53300 error
    connectionTimeoutMillis: 10000, // Wait longer for a connection if pool is full
    idleTimeoutMillis: 30000,
  },
});
