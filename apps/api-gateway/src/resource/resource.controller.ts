import {
  Controller,
  HttpCode,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  Get,
  Query,
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
import { CurrentUser, type JwtUser, IOffsetResponse } from '@slack/common';
import { ResourceScope, ResourceType } from './entity/resource.entity';
import { GetResourcesQueryDto } from './dto';
import { ResourceService } from './services/impl/resource.service';
import { IResourceResponse } from './types/upload.response';

@ApiTags('Resources')
@ApiBearerAuth()
@Controller('resources')
export class ResourceController {
  constructor(
    @Inject('CLOUDINARY_UPLOAD_SERVICE')
    private readonly uploadServce: UploadService,
    private readonly resourceService: ResourceService,
  ) { }

  @ApiOperation({ summary: 'Upload single file' })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @Post('upload-single-file')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtUser,
  ): Promise<IUploadResponse> {
    const uploadResult = await this.uploadServce.upload(file);

    // Save to database
    await this.resourceService.createResource({
      id: uploadResult.id,
      filename: uploadResult.filename,
      publicId: uploadResult.publicId,
      url: uploadResult.url,
      thumbnailUrl: uploadResult.thumbnailUrl,
      mimeType: uploadResult.mimeType,
      size: uploadResult.size,
      type: uploadResult.type as ResourceType,
      scope: ResourceScope.GLOBAL,
      uploadedBy: user.sub,
    });

    return uploadResult;
  }

  @ApiOperation({ summary: 'Upload multiple files' })
  @ApiResponse({ status: 201, description: 'Files uploaded successfully' })
  @Post('upload-multi-files')
  @HttpCode(201)
  @UseInterceptors(FilesInterceptor('files'))
  async uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: JwtUser,
  ): Promise<IUploadResponse[]> {
    const uploadResults = await this.uploadServce.uploadMany(files);

    // Save to database
    await Promise.all(
      uploadResults.map((res) =>
        this.resourceService.createResource({
          id: res.id,
          filename: res.filename,
          publicId: res.publicId,
          url: res.url,
          thumbnailUrl: res.thumbnailUrl,
          mimeType: res.mimeType,
          size: res.size,
          type: res.type as ResourceType,
          scope: ResourceScope.GLOBAL,
          uploadedBy: user.sub,
        }),
      ),
    );

    return uploadResults;
  }

  @ApiOperation({ summary: 'Get list of resources with paging' })
  @ApiResponse({ status: 200, description: 'Return list of resources' })
  @Get()
  async getResources(
    @Query() query: GetResourcesQueryDto,
  ): Promise<IOffsetResponse<IResourceResponse[]>> {
    return this.resourceService.getResources(query);
  }
}
