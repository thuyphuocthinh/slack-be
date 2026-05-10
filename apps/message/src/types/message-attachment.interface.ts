export interface IMessageAttachment {
  id: string;
  publicId: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  type: string;
  thumbnailUrl?: string;
}
