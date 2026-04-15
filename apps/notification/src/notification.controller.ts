import { Controller, Logger } from '@nestjs/common';
import { NotificationService } from './services/notification.service';
import { MessagePattern } from '@nestjs/microservices';
import { EmailService } from './services/email.service';
import { NOTIFICATION_MESSAGE_PATTERNS } from '@slack/constants';
import { EmailVerificationDto } from './dto';

@Controller()
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
  ) {}

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERNS.SEND_VERIFICATION_EMAIL)
  async sendVerificationEmail(data: EmailVerificationDto) {
    this.logger.log('Send verification email', data);
    await this.emailService.sendVerificationEmail(data.email, data.code);
  }

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERNS.SEND_RESET_PASSWORD_EMAIL)
  async sendResetPasswordEmail(data: EmailVerificationDto) {
    this.logger.log('Send reset password email', data);
    await this.emailService.sendResetPasswordEmail(data.email, data.code);
  }
}
