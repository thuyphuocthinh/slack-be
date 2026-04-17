export interface IUploadResponse {
  url: string;
  publicId: string;
  mimeType: string;
  size: number;
  filename: string;
  thumbnailUrl?: string;
}

export interface IResourceResponse {
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
}
