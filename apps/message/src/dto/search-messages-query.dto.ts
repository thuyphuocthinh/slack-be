export class SearchMessagesQueryDto {
  keyword: string;
  channelId: string;
  senderId: string;
  limit?: number;
  cursor?: string;
}
