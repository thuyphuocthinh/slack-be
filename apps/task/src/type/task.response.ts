export interface IBoardResponse {
  id: string;
  workspaceId: string;
  name: string;
  backgroundUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export class IBoardMemberResponse {
  id: string;
  memberId: string;
}

export interface IGroupResponse {
  id: string;
  boardId: string;
  name: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILabelResponse {
  id: string;
  boardId: string;
  name: string;
  color: string;
}

export interface ITaskResponse {
  id: string;
  groupId: string;
  title: string;
  description: string;
  dueDate: Date;
  order: number;
  labels: ILabelResponse[];
  members: ITaskMemberResponse[];
  attachments: ITaskAttachmentResponse[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ITaskAttachmentResponse {
  id: string;
  taskId: string;
  title: string;
  link: string;
}

export interface IChecklistResponse {
  id: string;
  taskId: string;
  name: string;
  items: IChecklistItemResponse[];
}

export interface IChecklistItemResponse {
  id: string;
  checklistId: string;
  content: string;
  isCompleted: boolean;
}

export interface ITaskMemberResponse {
  id: string;
  taskId: string;
  memberId: string;
}
