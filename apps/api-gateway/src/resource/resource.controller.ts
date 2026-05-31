import {
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Logger,
  Post,
  Get,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { IUploadResponse } from './types/upload.response';
import { type UploadService } from './services/upload_service.interface';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, type JwtUser, IOffsetResponse } from '@slack/common';
import { BILLING_ERROR } from '@slack/constants';
import { ResourceScope, ResourceType } from './entity/resource.entity';
import { GetResourcesQueryDto } from './dto';
import { ResourceService } from './services/impl/resource.service';
import { IResourceResponse } from './types/upload.response';
import { BillingService } from '../billing/billing.service';

const GB = 1024 * 1024 * 1024;

@ApiTags('Resources')
@ApiBearerAuth()
@Controller('resources')
export class ResourceController {
  private readonly logger = new Logger(ResourceController.name);

  constructor(
    @Inject('CLOUDINARY_UPLOAD_SERVICE')
    private readonly uploadServce: UploadService,
    private readonly resourceService: ResourceService,
    private readonly billingService: BillingService,
  ) {}

  @ApiOperation({ summary: 'Upload single file' })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @ApiResponse({ status: 403, description: 'Storage quota exceeded' })
  @Post('upload-single-file')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtUser,
  ): Promise<IUploadResponse> {
    await this.checkStorageQuota(user.sub, file.size);

    const uploadResult = await this.uploadServce.upload(file);
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
  @ApiResponse({ status: 403, description: 'Storage quota exceeded' })
  @Post('upload-multi-files')
  @HttpCode(201)
  @UseInterceptors(FilesInterceptor('files'))
  async uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: JwtUser,
  ): Promise<IUploadResponse[]> {
    const totalNewBytes = files.reduce((sum, f) => sum + f.size, 0);
    await this.checkStorageQuota(user.sub, totalNewBytes);

    const uploadResults = await this.uploadServce.uploadMany(files);
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

  // -------------------------------------------------------------------------
  // Check if user has remaining storage quota for the incoming upload
  // -------------------------------------------------------------------------
  private async checkStorageQuota(userId: string, incomingBytes: number): Promise<void> {
    try {
      const limits = await this.billingService.getUserFeatureLimits(userId);
      const maxStorageGb = (limits as { maxStorageGb: number | null }).maxStorageGb;

      if (maxStorageGb === null) return; // Unlimited — Pro/Premium plan

      const limitBytes = maxStorageGb * GB;
      const usedBytes = await this.resourceService.getUserStorageUsedBytes(userId);

      if (usedBytes + incomingBytes > limitBytes) {
        this.logger.warn(
          `Storage quota exceeded for userId: ${userId} — used: ${usedBytes}, limit: ${limitBytes}, incoming: ${incomingBytes}`,
        );
        throw new ForbiddenException(BILLING_ERROR.FEATURE_RESTRICTED.message);
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      // Billing service unavailable — allow upload (fail open)
      this.logger.warn(`Could not fetch billing limits for userId: ${userId}, allowing upload: ${err.message}`);
    }
  }
}
