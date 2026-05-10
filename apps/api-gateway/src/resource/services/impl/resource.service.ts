import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ResourceEntity } from '../../entity/resource.entity';
import { Repository } from 'typeorm';
import { CreateResourceDto } from '../../dto';
import { IResourceResponse } from '../../types/upload.response';

@Injectable()
export class ResourceService {
  constructor(
    @InjectRepository(ResourceEntity)
    private readonly resourceRepository: Repository<ResourceEntity>,
  ) {}

  private mapToResourceEntity(data: CreateResourceDto): ResourceEntity {
    const resource = new ResourceEntity();
    resource.id = data.id;
    resource.filename = data.filename;
    resource.publicId = data.publicId;
    resource.url = data.url;
    resource.thumbnailUrl = data.thumbnailUrl;
    resource.mimeType = data.mimeType;
    resource.size = data.size;
    resource.type = data.type;
    resource.workspaceId = data.workspaceId;
    resource.uploadedBy = data.uploadedBy;
    resource.refType = data.refType;
    resource.refId = data.refId;
    return resource;
  }

  private mapToResourceResponse(resource: ResourceEntity): IResourceResponse {
    return {
      id: resource.id,
      filename: resource.filename,
      publicId: resource.publicId,
      url: resource.url,
      thumbnailUrl: resource.thumbnailUrl,
      mimeType: resource.mimeType,
      size: resource.size,
      type: resource.type,
      workspaceId: resource.workspaceId,
      refType: resource.refType,
      refId: resource.refId,
    };
  }

  async createResource(data: CreateResourceDto): Promise<IResourceResponse> {
    const resource = this.mapToResourceEntity(data);
    return this.mapToResourceResponse(
      await this.resourceRepository.save(resource),
    );
  }

  async deleteResource(id: string): Promise<void> {
    await this.resourceRepository.delete(id);
  }

  async getResourceById(id: string): Promise<IResourceResponse> {
    const resource = await this.resourceRepository.findOne({ where: { id } });
    if (!resource) {
      throw new NotFoundException(`Resource with id ${id} not found`);
    }
    return this.mapToResourceResponse(resource);
  }

  async getResourceByWorkspaceId(
    workspaceId: string,
  ): Promise<IResourceResponse[]> {
    const resources = await this.resourceRepository.find({
      where: { workspaceId },
    });
    return resources.map(this.mapToResourceResponse);
  }

  async getResourceByRefTypeAndRefId(
    refType: string,
    refId: string,
  ): Promise<IResourceResponse[]> {
    const resources = await this.resourceRepository.find({
      where: { refType, refId },
    });
    return resources.map(this.mapToResourceResponse);
  }

  async getResourceByRefType(refType: string): Promise<IResourceResponse[]> {
    const resources = await this.resourceRepository.find({
      where: { refType },
    });
    return resources.map(this.mapToResourceResponse);
  }

  async getResourceByRefId(refId: string): Promise<IResourceResponse[]> {
    const resources = await this.resourceRepository.find({ where: { refId } });
    return resources.map(this.mapToResourceResponse);
  }

  async updateMetadata(
    resourceIds: string[],
    refType: string,
    refId: string,
  ): Promise<void> {
    await this.resourceRepository.update(resourceIds, { refType, refId });
  }
}
