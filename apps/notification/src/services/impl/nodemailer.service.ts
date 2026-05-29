import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { RpcException } from '@nestjs/microservices';
import { NOTIFICATION_ERROR } from '@slack/constants/errors/notification.error';
import type { IMailService } from '../mail.interface';

@Injectable()
export class NodemailerService implements IMailService {
  private readonly logger = new Logger(NodemailerService.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

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
        context: {
          ...context,
          frontendUrl: this.configService.get<string>('FRONTEND_URL'),
        },
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

  async sendUnrecognizedDeviceEmail(
    email: string,
    ipAddress?: string,
    userAgent?: string,
    time?: string,
  ): Promise<void> {
    try {
      await this.sendEmail(
        email,
        'New Login from Unrecognized Device',
        'unrecognized_device',
        {
          ipAddress: ipAddress || 'Unknown',
          userAgent: userAgent || 'Unknown',
          time: time || new Date().toISOString(),
        },
      );
    } catch (error) {
      this.logger.error('Failed to send unrecognized device email', error);
      throw new RpcException(NOTIFICATION_ERROR.SEND_EMAIL_FAILED);
    }
  }
}
