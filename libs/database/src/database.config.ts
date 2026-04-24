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

/*
`max: 25` trong cấu hình Database Pool có nghĩa là **số lượng kết nối (connection) vật lý tối đa** mà **MỘT** microservice được phép mở tới PostgreSQL tại cùng một thời điểm.

Bạn có thể hiểu đơn giản qua ví dụ này:

### 1. Hãy tưởng tượng Database là một cái Ngân hàng
*   **PostgreSQL:** Là cái ngân hàng, có tổng cộng 100 quầy giao dịch (đây là giới hạn `max_connections` mặc định của Postgres).
*   **Microservice (ví dụ Workspace Service):** Là một nhóm khách hàng đến giao dịch.
*   **`max: 25`:** Nghĩa là nhóm Workspace Service này chỉ được phép chiếm tối đa **25 quầy** trong ngân hàng đó.

### 2. Chuyện gì xảy ra khi có 500 request ập đến?
Nếu bạn có 500 request cùng lúc gửi tới Workspace Service:
*   **25 request đầu tiên:** Sẽ chiếm 25 kết nối và được Database xử lý ngay lập tức.
*   **475 request còn lại:** Không bị báo lỗi ngay. Chúng sẽ phải **xếp hàng chờ** trong một hàng đợi gọi là "Pool Queue". 
*   Khi 1 trong 25 request đầu tiên xong việc và trả lại kết nối, request tiếp theo trong hàng đợi sẽ được nhảy vào dùng ngay.

### 3. Tại sao không để `max: 100` hay `max: 500`?
Đây là lý do bạn gặp lỗi `53300 (too_many_connections)` lúc trước:
*   Bạn có nhiều service chạy song song: **Auth, User, Workspace, Gateway...**
*   Nếu mỗi service bạn để `max: 100`, thì tổng số kết nối mà các service muốn chiếm là: `100 + 100 + 100 + 100 = 400`.
*   Trong khi đó, Postgres của bạn chỉ chịu được tối đa **100**.
*   => **Kết quả:** Các service sẽ tranh giành nhau, và cái nào đến sau sẽ bị Postgres "đuổi thẳng cổ" bằng lỗi FATAL.

### 4. Lợi ích của việc để `max: 25`:
*   **An toàn:** Tổng số kết nối từ tất cả các service (ví dụ 4 service x 25 = 100) sẽ vừa khít với giới hạn của Postgres.
*   **Ổn định:** Request thà đợi một chút trong hàng đợi của Node.js (vài trăm ms) còn hơn là bị báo lỗi 500 và sập hệ thống.
*   **Hiệu năng:** Database thường chạy nhanh nhất khi số lượng kết nối vừa đủ (thường bằng số nhân CPU). Quá nhiều kết nối sẽ khiến Database tốn tài nguyên chỉ để quản lý các kết nối đó thay vì xử lý dữ liệu.

**Tóm lại:** `max: 25` là cách bạn "chia phần" tài nguyên Database cho các service để chúng chung sống hòa bình và không làm sập Database.
*/
