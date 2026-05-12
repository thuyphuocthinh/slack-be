export interface IUploadResponse {
  id: string;
  url: string;
  publicId: string;
  mimeType: string;
  size: number;
  filename: string;
  type: string;
  thumbnailUrl?: string;
}

export interface IResourceResponse {
  id: string;
  filename: string;
  publicId: string;
  url: string;
  thumbnailUrl?: string;
  mimeType: string;
  size: number;
  type: string;
  workspaceId?: string;
  refType?: string;
  refId?: string;
  createdAt: Date;
}
