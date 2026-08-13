import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// ver3.md mục 1 (dài hạn) — ghi nhớ 1 THỰC THỂ ổn định vừa được tạo thành công
// (ID/tên/link không tự đổi theo thời gian), KHÔNG ghi kết quả READ/tính toán
// (số liệu vẫn phải lấy lại như cũ, dễ lỗi thời). Đọc lại khi build prompt cho
// SupervisorService.plan(), luôn framing là GỢI Ý tham khảo, không phải cam
// kết tuyệt đối — thực thể vẫn có thể bị đổi/xoá bởi người khác sau đó.
@Entity('channel_memory')
export class ChannelMemoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'channel_id' })
  @Index()
  channelId: string;

  // Message bot đã sinh ra hành động này — dùng làm khoá dedupe cùng `content`
  // (xem unique index trong migration): luồng HITL có thể gọi updateMessage()
  // nhiều lần cho CÙNG 1 message với toolCalls đã persist trước đó lặp lại
  // nguyên văn (attachPendingToolCallTrace() lúc pause, rồi approveCheckpoint()
  // lúc resume) — không có khoá này sẽ ghi trùng mỗi lần update.
  @Column({ type: 'uuid', name: 'source_message_id' })
  sourceMessageId: string;

  @Column({ type: 'varchar' })
  tool: string;

  // "<tool>: <resultPreview>", đã cắt theo CHANNEL_MEMORY_CONTENT_MAX_CHARS.
  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
