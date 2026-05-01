import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { I_MAIL_SERVICE, type IMailService } from './services/mail.interface';
import { NotificationService } from './services/impl/notification.service';
import { NOTIFICATION_MESSAGE_PATTERNS } from '@slack/constants';
import { Inject } from '@nestjs/common';
import {
  EmailVerificationDto,
  SendMailDto,
  FetchNotificationsDto,
  PushNotificationDto,
  MarkNotificationDto,
  MarkAllAsReadDto,
  DeleteNotificationDto,
} from './dto';

@Controller()
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(
    @Inject(I_MAIL_SERVICE) private readonly emailService: IMailService,
    private readonly notificationService: NotificationService,
  ) {}

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERNS.SEND_VERIFICATION_EMAIL)
  async sendVerificationEmail(@Payload() data: EmailVerificationDto) {
    this.logger.log('Send verification email', data);
    await this.emailService.sendVerificationEmail(data.email, data.code);
  }

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERNS.SEND_RESET_PASSWORD_EMAIL)
  async sendResetPasswordEmail(@Payload() data: EmailVerificationDto) {
    this.logger.log('Send reset password email', data);
    await this.emailService.sendResetPasswordEmail(data.email, data.code);
  }

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERNS.SEND_MAIL)
  async sendMail(@Payload() data: SendMailDto) {
    this.logger.log('Send mail', data);
    await this.emailService.sendEmail(
      data.to,
      data.subject,
      data.template,
      data.context,
    );
  }

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERNS.FETCH_NOTIFICATIONS)
  async fetchNotifications(@Payload() data: FetchNotificationsDto) {
    return this.notificationService.fetchNotifications(data);
  }

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERNS.PUSH_NOTIFICATION)
  async pushNotification(@Payload() data: PushNotificationDto) {
    return this.notificationService.pushNotification(data);
  }

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERNS.MARK_AS_READ)
  async markAsRead(@Payload() data: MarkNotificationDto) {
    return this.notificationService.markAsRead(data);
  }

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERNS.MARK_ALL_AS_READ)
  async markAllAsRead(@Payload() data: MarkAllAsReadDto) {
    return this.notificationService.markAllAsRead(data);
  }

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERNS.DELETE_NOTIFICATION)
  async deleteNotification(@Payload() data: DeleteNotificationDto) {
    return this.notificationService.deleteNotification(data);
  }

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERNS.GET_UNREAD_SUMMARY)
  async getUnreadSummary(@Payload() payload: { userId: string }) {
    return this.notificationService.getUnreadSummary(payload.userId);
  }
}
