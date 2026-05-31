import { DataSourceOptions } from 'typeorm';
import { join } from 'path';

export const getDataSourceOptions = (): DataSourceOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5434', 10),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  synchronize: false,
  logging: ['error'],
  entities: [
    join(process.cwd(), 'apps/**/*.entity.{js,ts}'),
    join(process.cwd(), 'libs/**/*.entity.{js,ts}'),
  ],
  migrations: [join(process.cwd(), 'apps/**/migrations/**/*.{js,ts}')],
  extra: {
    // Sử dụng biến môi trường DB_POOL_SIZE (mặc định 50 khi có PgBouncer)
    max: parseInt(process.env.DB_POOL_SIZE || '50', 10),
    connectionTimeoutMillis: 10000, // Wait longer for a connection if pool is full
    idleTimeoutMillis: 30000,
  },
});

/*
GIẢI THÍCH KIẾN TRÚC DATABASE POOLING & PGBOUNCER:

1. Khi chưa dùng PgBouncer (Kết nối trực tiếp Postgres - Port 5434/5432):
   - Mỗi microservice nên để `max: 25`. Nếu có 4 services chạy song song (Auth, User, Workspace, Gateway), tổng số kết nối vật lý sẽ là 4 x 25 = 100 (vừa khít giới hạn max_connections mặc định của Postgres).

2. Khi đã dùng PgBouncer (Kết nối qua Proxy - Port 6432):
   - PgBouncer hoạt động ở chế độ `Transaction Pooling`. Hàng nghìn kết nối từ NestJS tới PgBouncer chỉ là kết nối ảo (Virtual Connections).
   - Khi service thực thi câu lệnh SQL, PgBouncer mới mượn 1 kết nối vật lý trong số 50-100 kết nối tới Postgres để chạy, chạy xong trả lại ngay.
   - Do đó, bạn có thể thoải mái đặt `DB_POOL_SIZE=50` (hoặc 100) trên mỗi microservice mà không bao giờ lo Postgres bị quá tải hay báo lỗi `53300 (too_many_connections)`.
*/
