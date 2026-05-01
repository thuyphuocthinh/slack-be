import {
  Controller,
  HttpCode,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { IUploadResponse } from './types/upload.response';
import { type UploadService } from './services/upload_service.interface';
import { Inject } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Resources')
@ApiBearerAuth()
@Controller('resources')
export class ResourceController {
  constructor(
    @Inject('CLOUDINARY_UPLOAD_SERVICE')
    private readonly uploadServce: UploadService,
  ) {}

  @ApiOperation({ summary: 'Upload single file' })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @Post('upload-single-file')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<IUploadResponse> {
    return this.uploadServce.upload(file);
  }

  @ApiOperation({ summary: 'Upload multiple files' })
  @ApiResponse({ status: 201, description: 'Files uploaded successfully' })
  @Post('upload-multi-files')
  @HttpCode(201)
  @UseInterceptors(FilesInterceptor('files'))
  async uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<IUploadResponse[]> {
    return this.uploadServce.uploadMany(files);
  }
}
