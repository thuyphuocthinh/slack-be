import { EJobName } from '../constants/queue.constant';

export interface IInviteJobData {
  to: string;
  subject: string;
  template: string;
  context: Record<string, any>;
}

export interface IEmailJobData {
  email: string;
  code: string;
}

export interface INotificationJobData {
  userId: string;
  title: string;
  message: string;
  metadata?: any;
}

export type TJobData = {
  [EJobName.SEND_VERIFICATION_EMAIL]: IEmailJobData;
  [EJobName.SEND_INVITE_EMAIL]: IInviteJobData;
  [EJobName.SEND_PASSWORD_RESET_EMAIL]: IEmailJobData;
};
