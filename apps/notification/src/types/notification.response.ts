import { NotificationType, NotificationStatus } from '@slack/constants';

export interface NotificationResponse {
  id: string;
  recipientId: string;
  templateKey: string;
  content: string | null;
  type: NotificationType;
  status: NotificationStatus;
  objectId: string;
  objectType: string;
  metadata: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
}
