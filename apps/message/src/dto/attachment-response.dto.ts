export class AttachmentResponseDto {
  id: string;
  messageId: string;
  resourceId: string;
  publicId: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  type: string;
  thumbnailUrl?: string;
  createdAt: Date;
}
