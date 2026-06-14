import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { EmbeddingService } from './embedding.service';
import { DocumentService } from './document.service';
import { AiDocumentChunkEntity } from './entities/ai-document-chunk.entity';
import { AiDocumentParentEntity } from './entities/ai-document-parent.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiDocumentChunkEntity, AiDocumentParentEntity]),
  ],
  controllers: [AiController],
  providers: [AiService, EmbeddingService, DocumentService],
  exports: [AiService, DocumentService],
})
export class AiModule {}
