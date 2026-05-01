import { IUploadResponse } from '../types/upload.response';

// upload.interface.ts
export interface UploadService {
  upload(file: Express.Multer.File): Promise<IUploadResponse>;

  uploadMany(files: Express.Multer.File[]): Promise<IUploadResponse[]>;

  delete(publicId: string): Promise<void>;
}
