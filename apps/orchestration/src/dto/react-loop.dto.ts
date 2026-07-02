export class RunReactLoopRequestDto {
  prompt: string;
  provider: string;
  userId: string;
  channelId: string;
  workspaceId: string;
  // messageId của message BOT (reply) — dùng để stream step lên đúng bubble
  messageId: string;
  // messageId gốc user vừa gửi — dùng làm cursor lấy lịch sử chat TRƯỚC nó
  triggerMessageId: string;
  channelType: string; // 'direct' | 'group'
}
