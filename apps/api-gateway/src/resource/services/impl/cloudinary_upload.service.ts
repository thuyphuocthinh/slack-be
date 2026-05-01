// cloudinary-upload.service.ts
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { RESOURCE_ERROR } from '@slack/constants';
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

  private calculateLimit(file: Express.Multer.File) {
    const { mimetype } = file;
    let limit = 20 * 1024 * 1024; // Default 20MB

    if (mimetype.startsWith('image/')) {
      limit = 5 * 1024 * 1024; // 5MB
    } else if (mimetype.startsWith('video/')) {
      limit = 100 * 1024 * 1024; // 100MB
    }

    return limit;
  }

  private validateFile(file: Express.Multer.File) {
    const limit = this.calculateLimit(file);
    const { size } = file;

    if (size > limit) {
      throw new BadRequestException({
        ...RESOURCE_ERROR.FILE_SIZE_EXCEEDED,
        message: `${RESOURCE_ERROR.FILE_SIZE_EXCEEDED.message}: ${limit / (1024 * 1024)}MB`,
      });
    }
  }

  async upload(file: Express.Multer.File): Promise<IUploadResponse> {
    this.validateFile(file);
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

  async uploadMany(files: Express.Multer.File[]): Promise<IUploadResponse[]> {
    files.forEach((file) => this.validateFile(file));
    return Promise.all(files.map((file) => this.upload(file)));
  }

  async delete(publicId: string) {
    await cloudinary.uploader.destroy(publicId);
  }
}
