import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import sgMail from '@sendgrid/mail';
import { NOTIFICATION_ERROR } from '@slack/constants/errors/notification.error';
import { IMailService } from '../mail.interface';

@Injectable()
export class SendgridService implements IMailService {
  private readonly logger = new Logger(SendgridService.name);

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    if (apiKey) {
      sgMail.setApiKey(apiKey);
    } else {
      this.logger.warn('SENDGRID_API_KEY is not set');
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    template: string,
    context: Record<string, string>,
  ): Promise<void> {
    const from = this.configService.get<string>('MAIL_FROM');

    try {
      const updatedContext = {
        ...context,
        frontendUrl: this.configService.get<string>('FRONTEND_URL'),
      };

      const msg = {
        to,
        from: from || 'no-reply@slack.com',
        subject,
        text: `Email template: ${template}, context: ${JSON.stringify(updatedContext)}`,
        html: `<strong>Email template: ${template}</strong><br>Context: ${JSON.stringify(updatedContext)}`,
      };

      await sgMail.send(msg);

      this.logger.log(
        `Sent SendGrid email to email: ${to}, subject: ${subject}, template: ${template}`,
      );
    } catch (error) {
      this.logger.error('Failed to send SendGrid email', error);
      throw new RpcException(NOTIFICATION_ERROR.SEND_EMAIL_FAILED);
    }
  }

  async sendVerificationEmail(email: string, code: string): Promise<void> {
    try {
      await this.sendEmail(email, 'Verify your email', 'verification', {
        code,
      });
    } catch (error) {
      this.logger.error('Failed to send SendGrid verification email', error);
      throw new RpcException(NOTIFICATION_ERROR.SEND_VERIFICATION_EMAIL_FAILED);
    }
  }

  async sendResetPasswordEmail(email: string, code: string): Promise<void> {
    try {
      await this.sendEmail(email, 'Reset your password', 'reset_password', {
        code,
      });
    } catch (error) {
      this.logger.error('Failed to send SendGrid reset password email', error);
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
      this.logger.error('Failed to send SendGrid unrecognized device email', error);
      throw new RpcException(NOTIFICATION_ERROR.SEND_EMAIL_FAILED);
    }
  }
}
