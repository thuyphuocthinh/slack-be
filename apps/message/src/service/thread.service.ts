import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MessageEntity } from '../entity/message.entity';
import { DataSource, Repository } from 'typeorm';
import { MessageService } from './message.service';
import { ThreadResponseDto } from '../dto';

@Injectable()
export class ThreadService {
  private readonly logger = new Logger(ThreadService.name);

  constructor(
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
    private readonly messageService: MessageService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Get all threads involving the user
   * 1. Đảm bảo:
   * - Mới nhất lên đầu (Dựa vào tin nhắn cuối cùng trong thread)
   * - User ở trong thread đó thông qua author root, author reply hoặc được mention
   * - Message đầu + Tổng số reply (Hydration xử lý việc này)
   */
  async getUserThreads(
    userId: string,
    limit: number = 10,
    cursor?: string,
  ): Promise<ThreadResponseDto> {
    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);

      // Subquery tìm tất cả rootId mà user có tham gia
      /*
        SELECT root.*, 
        (
            SELECT MAX(reply.created_at) 
            FROM messages reply     
            WHERE reply.parent_id = root.id
        ) AS "lastActivity"
        FROM messages root
        WHERE root.id IN (
            SELECT DISTINCT COALESCE(m.parent_id, m.id)
            FROM messages m
            LEFT JOIN message_mentions mention ON m.id = mention.message_id
            WHERE m.user_id = :userId OR mention.user_id = :userId
        )
        AND root.parent_id IS NULL
        AND EXISTS (SELECT 1 FROM messages r WHERE r.parent_id = root.id)
        ORDER BY COALESCE("lastActivity", root.created_at) DESC
        LIMIT :limit OFFSET :offset
      */

      const involvedRootsQuery = messageRepo
        .createQueryBuilder('m')
        .select('DISTINCT COALESCE(m.parent_id, m.id)', 'rootId')
        .leftJoin('m.mentions', 'mention')
        .where('m.userId = :userId', { userId })
        .orWhere('mention.userId = :userId', { userId });

      // Query chính lấy thông tin các root message
      const queryBuilder = messageRepo
        .createQueryBuilder('root')
        .leftJoinAndSelect('root.reactions', 'reaction')
        .leftJoinAndSelect('root.mentions', 'mention')
        // Lấy thời gian của reply mới nhất để sort
        .addSelect((sub) => {
          return sub
            .select('MAX(reply.createdAt)', 'lastActivity')
            .from(MessageEntity, 'reply')
            .where('reply.parentId = root.id');
        }, 'lastActivity')
        .where(`root.id IN (${involvedRootsQuery.getQuery()})`)
        .setParameters(involvedRootsQuery.getParameters())
        .andWhere('root.parentId IS NULL')
        // Chỉ lấy những thread đã có ít nhất 1 reply (đúng chuẩn Slack Threads view)
        .andWhere(
          'EXISTS (SELECT 1 FROM messages r WHERE r.parent_id = root.id)',
        )
        // Sort theo hoạt động mới nhất (reply mới nhất hoặc ngày tạo root)
        // Hàm COALESCE trong SQL được sử dụng để kiểm tra danh sách các biểu thức và trả về giá trị đầu tiên không phải NULL.
        // Ví dụ: COALESCE("lastActivity", root.createdAt) sẽ trả về giá trị của "lastActivity" nếu nó không phải NULL, ngược lại sẽ trả về giá trị của "root.createdAt".
        .orderBy('COALESCE("lastActivity", root.createdAt)', 'DESC');

      if (cursor) {
        // Pagination logic với cursor có thể dùng UUIDv7 hoặc timestamp
        // load more => lay cac thread < thread cuoi cung của danh sách hiện tại (theo thứ tự DESC)
        queryBuilder.andWhere('root.id < :cursor', { cursor });
      }

      /*
        cursor = 3 => [1,2,3,4] => take 4 (limit + 1)
        hasMore = true
        resultMessages = [1,2,3]
        nextCursor = 3
        
        cursor = 2 => [1,2,3] => take 3 (limit + 1)
        hasMore = true
        resultMessages = [1,2]
        nextCursor = 2
        
        cursor = 1 => [1] => take 1 (limit + 1)
        hasMore = false
        resultMessages = [1]
        nextCursor = undefined
      */
      queryBuilder.take(limit + 1);
      const rootMessages = await queryBuilder.getMany();
      const hasMore = rootMessages.length > limit;
      const resultMessages = hasMore
        ? rootMessages.slice(0, limit)
        : rootMessages;

      // Sử dụng hydrateMessages từ MessageService để lấy đầy đủ info sender, reactions, replyCount
      const response = await this.messageService.hydrateMessages(
        resultMessages,
        manager,
      );

      return {
        threads: response,
        nextCursor: hasMore
          ? resultMessages[resultMessages.length - 1].id
          : undefined,
      };
    });
  }

  /*
    1. Đảm bảo
    - Mới nhất lên đầu
    - User ở trong thread đó thông qua mention hoặc root của thread
    - Message đầu + Tổng số reply => bấm xem chi tiết thread thì mới load thread
    
    2. Cách hoạt động
    - Mỗi lần lấy 10 thread
    - Lấy các message có parentId khác null và đảm bảo user tồn tại ít nhất trong thread (mention hoặc root thread)
    - Sort theo parentId (DESC)
    - Đếm số message có cùng parentId => totalReply
    
    3. Xử lí realtime
    - Thêm mới bên message reply => đồng thời thêm bên thread
    - Một messsage trong thread bị xóa => đồng thời xóa bên thread
    - Một messsage trong thread được edit => đồng thời edit bên thread
    - Một message là root thread bị xóa => tất cả các message trong thread đó bị xóa
      Xử lý Real-time (Phân tích):
      - Khi có message reply mới: Gateway sẽ emit event 'message.reply_created' 
        đến các participants trong thread để update UI local.
      - Khi xóa root message: TypeORM sẽ cascade delete hoặc ta phải xóa thủ công các con.
      - Khi edit message: Chỉ cần emit update event.
      */
}

/*

Đây là kỹ thuật **"Plus One"** thường dùng trong phân trang bằng Cursor (Cursor-based Pagination). Mục đích chính là để xác định xem còn dữ liệu ở trang sau hay không mà không cần phải thực hiện một câu lệnh `COUNT(*)` tốn kém.

Mình sẽ giải thích từng dòng dựa trên ví dụ của bạn:

### 1. Tại sao lại là `limit + 1`?
*   **Giả sử:** Bạn muốn lấy 2 tin nhắn (`limit = 2`).
*   **Code:** `queryBuilder.take(limit + 1)` => Bạn yêu cầu Database lấy **3** tin nhắn.
*   **Lý do:** 
    *   Nếu DB trả về **3** tin nhắn: Bạn biết chắc chắn là vẫn còn dữ liệu ở trang tiếp theo.
    *   Nếu DB chỉ trả về **2** (hoặc ít hơn) tin nhắn: Bạn biết chắc chắn là đã hết dữ liệu, đây là trang cuối cùng.

### 2. Biến `hasMore`
*   `hasMore = rootMessages.length > limit;`
*   Nếu bạn lấy được 3 phần tử (trong khi chỉ cần 2), thì `hasMore` sẽ là `true`. Đây là tín hiệu để Frontend hiển thị nút "Load More" hoặc tiếp tục Infinite Scroll.

### 3. Cắt bớt phần tử thừa (`slice`)
*   `resultMessages = hasMore ? rootMessages.slice(0, limit) : rootMessages;`
*   Vì bạn chỉ hứa trả về cho người dùng 2 tin nhắn, nên bạn phải cắt bỏ cái thứ 3 (cái dư ra chỉ dùng để check `hasMore`).

### 4. Xác định `nextCursor`
*   `nextCursor: hasMore ? resultMessages[resultMessages.length - 1].id : undefined`
*   Ở trang tiếp theo, người dùng cần biết bắt đầu từ đâu. Bạn gửi về ID của tin nhắn **cuối cùng trong danh sách kết quả** (tin nhắn thứ 2).
*   Khi người dùng gọi API tiếp theo với `cursor = msg2.id`, câu query sẽ chạy: `WHERE root.id < 'msg2.id'`. Nó sẽ lấy tiếp từ tin nhắn thứ 3 trở đi.

Kỹ thuật này cực kỳ tối ưu vì bạn chỉ cần truy vấn đúng số lượng cần thiết cộng thêm 1, tránh được việc phải đếm tổng số bản ghi trong bảng có hàng triệu dòng.
*/
