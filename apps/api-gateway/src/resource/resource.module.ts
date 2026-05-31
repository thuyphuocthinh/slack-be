import { Module } from '@nestjs/common';
import { CloudinaryUploadService } from './services/impl/cloudinary_upload.service';
import { ResourceController } from './resource.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResourceEntity } from './entity/resource.entity';
import { ResourceService } from './services/impl/resource.service';
import { DatabaseModule } from '@slack/database';
import { v2 as cloudinary } from 'cloudinary';
import { EQueueName, QueueModule } from '@slack/queue';
import { ResourceProcessor } from './processors/resource.processor';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    BillingModule,
    DatabaseModule,
    TypeOrmModule.forFeature([ResourceEntity]),
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.RESOURCE_QUEUE]),
  ],
  controllers: [ResourceController],
  providers: [
    {
      provide: 'CLOUDINARY',
      useFactory: () => {
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
        });

        return cloudinary;
      },
    },
    { provide: 'CLOUDINARY_UPLOAD_SERVICE', useClass: CloudinaryUploadService },
    ResourceService,
    ResourceProcessor,
  ],
})
export class ResourceModule {}
