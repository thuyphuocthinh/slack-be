import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { RpcException } from '@nestjs/microservices';
import { NOTIFICATION_ERROR } from '@slack/constants/errors/notification.error';
import { IMailService } from '../mail.interface';

@Injectable()
export class NodemailerService implements IMailService {
  private readonly logger = new Logger(NodemailerService.name);

  constructor(private readonly mailerService: MailerService) {}

  async sendEmail(
    to: string,
    subject: string,
    template: string,
    context: Record<string, string>,
  ): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to,
        subject,
        template,
        context,
      });
      this.logger.log(
        `Sent email to email: ${to}, subject: ${subject}, template: ${template}`,
      );
    } catch (error) {
      this.logger.error('Failed to send email', error);
      throw new RpcException(NOTIFICATION_ERROR.SEND_EMAIL_FAILED);
    }
  }

  async sendVerificationEmail(email: string, code: string): Promise<void> {
    try {
      await this.sendEmail(email, 'Verify your email', 'verification', {
        code,
      });
    } catch (error) {
      this.logger.error('Failed to send verification email', error);
      throw new RpcException(NOTIFICATION_ERROR.SEND_VERIFICATION_EMAIL_FAILED);
    }
  }

  async sendResetPasswordEmail(email: string, code: string): Promise<void> {
    try {
      await this.sendEmail(email, 'Reset your password', 'reset_password', {
        code,
      });
    } catch (error) {
      this.logger.error('Failed to send reset password email', error);
      throw new RpcException(
        NOTIFICATION_ERROR.SEND_RESET_PASSWORD_EMAIL_FAILED,
      );
    }
  }
}
