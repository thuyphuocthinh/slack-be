import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { RpcException } from '@nestjs/microservices';
import { NOTIFICATION_ERROR } from '@slack/constants/errors/notification.error';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly mailerService: MailerService) {}

  async sendVerificationEmail(email: string, code: string): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Verify your email',
        template: 'verification',
        context: {
          code,
        },
      });
      this.logger.log(
        `Sent verification email to email: ${email}, code: ${code}`,
      );
    } catch (error) {
      this.logger.error('Failed to send verification email', error);
      throw new RpcException(NOTIFICATION_ERROR.SEND_VERIFICATION_EMAIL_FAILED);
    }
  }

  async sendResetPasswordEmail(email: string, code: string): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Reset your password',
        template: 'reset_password',
        context: {
          code,
          email,
        },
      });
      this.logger.log(
        `Sent reset password email to email: ${email}, code: ${code}`,
      );
    } catch (error) {
      this.logger.error('Failed to send reset password email', error);
      throw new RpcException(
        NOTIFICATION_ERROR.SEND_RESET_PASSWORD_EMAIL_FAILED,
      );
    }
  }
}
