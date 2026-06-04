import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { EmbeddingService } from './embedding.service';
import { DocumentService } from './document.service';
import { AiDocumentChunkEntity } from './entities/ai-document-chunk.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AiDocumentChunkEntity])],
  controllers: [AiController],
  providers: [AiService, EmbeddingService, DocumentService],
  exports: [AiService, DocumentService],
})
export class AiModule {}
