// cloudinary-upload.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UploadService } from '../upload_service.interface';
import {
  v2 as cloudinary,
  UploadApiErrorResponse,
  UploadApiResponse,
} from 'cloudinary';
import { IUploadResponse } from '../../types/upload.response';

@Injectable()
export class CloudinaryUploadService implements UploadService {
  private readonly logger = new Logger(CloudinaryUploadService.name);

  constructor(@Inject('CLOUDINARY') private readonly cloudinary) {}

  async upload(file: Express.Multer.File): Promise<IUploadResponse> {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = this.cloudinary.uploader.upload_stream(
        {
          resource_type: 'auto',
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined,
        ) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Upload failed'));
          resolve(result);
        },
      );

      stream.end(file.buffer);
    });

    this.logger.log(`File uploaded successfully: ${result.secure_url}`);

    return {
      url: result.secure_url,
      publicId: result.public_id,
      mimeType: file.mimetype,
      size: file.size,
      filename: file.originalname,
      thumbnailUrl: result.secure_url,
    };
  }

  async delete(publicId: string) {
    await cloudinary.uploader.destroy(publicId);
  }
}
