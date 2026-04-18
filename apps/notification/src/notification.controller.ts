import { Controller, Logger } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { EmailService } from './services/email.service';
import { NOTIFICATION_MESSAGE_PATTERNS } from '@slack/constants';
import { EmailVerificationDto, SendMailDto } from './dto';

@Controller()
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private readonly emailService: EmailService) {}

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

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERNS.SEND_MAIL)
  async sendMail(data: SendMailDto) {
    this.logger.log('Send mail', data);
    await this.emailService.sendEmail(
      data.to,
      data.subject,
      data.template,
      data.context,
    );
  }
}
