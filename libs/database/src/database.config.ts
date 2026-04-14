import { DataSourceOptions } from 'typeorm';
import { join } from 'path';

export const getDataSourceOptions = (): DataSourceOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  synchronize: false,
  logging: ['error', 'warn', 'info', 'schema'],
  entities: [
    join(process.cwd(), 'apps/**/*.entity.{js,ts}'),
    join(process.cwd(), 'libs/**/*.entity.{js,ts}'),
  ],
  migrations: [join(process.cwd(), 'apps/**/migrations/**/*.{js,ts}')],
  extra: {
    max: 20, // Số kết nối tối đa mỗi pool được mở tới DB đối với mỗi microservice.
    connectionTimeoutMillis: 5000, // Thời gian tối đa (ms) đợi kết nối nếu pool đang cạn (5 giây).
    idleTimeoutMillis: 30000, // Đóng kết nối nếu rảnh rỗi không làm gì sau 30 giây để giải phóng bộ nhớ.
  },
});
