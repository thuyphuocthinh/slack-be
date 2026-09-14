import { Module } from '@nestjs/common';
import { DatabaseModule } from '@slack/database';
import { CachedModule } from '@slack/cached';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { NoteController } from './note.controller';
import { HocuspocusGateway } from './hocuspocus/hocuspocus.gateway';
import { PagesEntity } from './entity/pages.entity';
import { PageDocumentsEntity } from './entity/page_documents.entity';
import { PermissionsEntity } from './entity/permissions.entity';
import { BlocksEntity } from './entity/blocks.entity';
import { PropertiesEntity } from './entity/properties.entity';
import { ViewsEntity } from './entity/views.entity';
import { PropertyValuesEntity } from './entity/property_values.entity';
import { PermissionsService } from './services/permissions.service';
import { PagesService } from './services/pages.service';
import { BlocksService } from './services/blocks.service';
import { DatabaseService } from './services/database.service';
import { YjsBlocksSyncService } from './services/yjs-blocks-sync.service';

@Module({
  imports: [
    DatabaseModule,
    CachedModule.forRoot(),
    TypeOrmModule.forFeature([
      PagesEntity,
      PageDocumentsEntity,
      PermissionsEntity,
      BlocksEntity,
      PropertiesEntity,
      ViewsEntity,
      PropertyValuesEntity,
    ]),
    JwtModule.register({}),
  ],
  controllers: [NoteController],
  providers: [
    HocuspocusGateway,
    PagesService,
    PermissionsService,
    BlocksService,
    DatabaseService,
    YjsBlocksSyncService,
  ],
})
export class NoteModule {}
