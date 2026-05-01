export class CreateBoardRequestDto {
  workspaceId: string;
  backgroundUrl: string;
  name: string;
  requesterId: string;
}

export class UpdateBoardRequestDto {
  id: string;
  name?: string;
  backgroundUrl?: string;
  requesterId: string;
}

export class QueryBoardRequestDto {
  workspaceId: string;
  page?: number;
  limit?: number;
  requesterId: string;
}

export class CreateGroupRequestDto {
  boardId: string;
  name: string;
  order?: number;
  requesterId: string;
}

export class UpdateGroupRequestDto {
  id: string;
  name?: string;
  order?: number;
  requesterId: string;
}

export class CreateTaskRequestDto {
  groupId: string;
  title: string;
  requesterId: string;
}

export class UpdateTaskRequestDto {
  id: string;
  title?: string;
  requesterId: string;
}

export class QueryTaskRequestDto {
  groupId: string;
  page?: number;
  limit?: number;
  requesterId: string;
}

export class CreateLabelRequestDto {
  boardId: string;
  name: string;
  color: string;
  requesterId: string;
}

export class UpdateLabelRequestDto {
  id: string;
  name?: string;
  color?: string;
  requesterId: string;
}

export class CreateChecklistRequestDto {
  taskId: string;
  name: string;
  requesterId: string;
}

export class UpdateChecklistRequestDto {
  id: string;
  name?: string;
  requesterId: string;
}

export class AddChecklistItemRequestDto {
  checklistId: string;
  content: string;
  requesterId: string;
}

export class UpdateChecklistItemRequestDto {
  id: string;
  content?: string;
  isCompleted?: boolean;
  requesterId: string;
}
