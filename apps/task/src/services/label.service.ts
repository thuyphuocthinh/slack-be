import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { LabelEntity } from '../entity/label.entity';
import { CreateLabelDto, UpdateLabelDto } from '../dto/label.dto';
import { RpcException } from '@nestjs/microservices';
import { TASK_ERROR } from '@slack/constants';
import { ILabelResponse } from '../type/task.response';
import { TaskCommonService } from './task-common.service';

@Injectable()
export class LabelService {
  constructor(
    @InjectRepository(LabelEntity)
    private readonly labelRepo: Repository<LabelEntity>,
    private readonly dataSource: DataSource,
    private readonly commonService: TaskCommonService,
  ) {}

  async createNewLabel(
    dto: CreateLabelDto,
    requesterId: string,
  ): Promise<ILabelResponse> {
    await this.commonService.checkWorkspaceMembership(
      dto.workspaceId,
      requesterId,
    );
    const label = this.labelRepo.create(dto);
    const saved = await this.labelRepo.save(label);
    return this.mapLabelResponse(saved);
  }

  async updateLabelInfo(
    id: string,
    dto: UpdateLabelDto,
    requesterId: string,
  ): Promise<ILabelResponse> {
    return await this.dataSource.transaction(async (manager) => {
      const label = await manager.findOne(LabelEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!label) throw new RpcException(TASK_ERROR.LABEL_NOT_FOUND);

      await this.commonService.checkWorkspaceMembership(
        label.workspaceId,
        requesterId,
      );

      Object.assign(label, dto);
      const saved = await manager.save(label);
      return this.mapLabelResponse(saved);
    });
  }

  async deleteLabel(id: string, requesterId: string): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      const label = await manager.findOne(LabelEntity, { where: { id } });
      if (!label) throw new RpcException(TASK_ERROR.LABEL_NOT_FOUND);

      await this.commonService.checkWorkspaceMembership(
        label.workspaceId,
        requesterId,
      );

      await manager.remove(label);
      return `Label with ID ${id} has been deleted`;
    });
  }

  async getLabelsInWorkspace(
    workspaceId: string,
    requesterId: string,
  ): Promise<ILabelResponse[]> {
    await this.commonService.checkWorkspaceMembership(workspaceId, requesterId);
    const labels = await this.labelRepo.find({ where: { workspaceId } });
    return labels.map((l) => this.mapLabelResponse(l));
  }

  private mapLabelResponse(label: LabelEntity): ILabelResponse {
    return {
      id: label.id,
      workspaceId: label.workspaceId,
      name: label.name,
      color: label.color,
    };
  }
}
