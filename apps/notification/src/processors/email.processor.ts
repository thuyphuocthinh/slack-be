import { Processor } from '@nestjs/bullmq';
import {
  BaseProcessor,
  EQueueName,
  EJobName,
  IEmailJobData,
  IInviteJobData,
  IGenericEmailJobData,
  IUnrecognizedDeviceEmailJobData,
} from '@slack/queue';
import { Job } from 'bullmq';
import { Inject } from '@nestjs/common';
import { I_MAIL_SERVICE, type IMailService } from '../services/mail.interface';

@Processor(EQueueName.EMAIL_QUEUE, { concurrency: 5 })
export class EmailProcessor extends BaseProcessor<
  IEmailJobData | IInviteJobData | IGenericEmailJobData | IUnrecognizedDeviceEmailJobData,
  void,
  EJobName
> {
  constructor(
    @Inject(I_MAIL_SERVICE) private readonly mailerService: IMailService,
  ) {
    super();
  }

  async process(
    job: Job<IEmailJobData | IInviteJobData | IGenericEmailJobData | IUnrecognizedDeviceEmailJobData, void, EJobName>,
  ): Promise<void> {
    switch (job.name) {
      case EJobName.SEND_VERIFICATION_EMAIL: {
        const { email, code } = job.data as IEmailJobData;
        this.logger.log(`Handling verification email for ${email}`);
        return await this.mailerService.sendVerificationEmail(email, code);
      }

      case EJobName.SEND_PASSWORD_RESET_EMAIL: {
        const { email, code } = job.data as IEmailJobData;
        this.logger.log(`Handling password reset email for ${email}`);
        return await this.mailerService.sendResetPasswordEmail(email, code);
      }

      case EJobName.SEND_INVITE_EMAIL: {
        const { to, subject, template, context } = job.data as IInviteJobData;
        this.logger.log(`Handling invite email for ${to}`);
        return await this.mailerService.sendEmail(
          to,
          subject,
          template,
          context,
        );
      }

      case EJobName.SEND_GENERIC_EMAIL: {
        const { to, subject, template, context } = job.data as IGenericEmailJobData;
        this.logger.log(`Handling generic email for ${to}`);
        return await this.mailerService.sendEmail(
          to,
          subject,
          template,
          context,
        );
      }

      case EJobName.SEND_UNRECOGNIZED_DEVICE_EMAIL: {
        const { email, ipAddress, userAgent, time, secureToken } = job.data as IUnrecognizedDeviceEmailJobData;
        this.logger.log(`Handling unrecognized device email for ${email}`);
        return await this.mailerService.sendUnrecognizedDeviceEmail(
          email,
          ipAddress,
          userAgent,
          time,
          secureToken,
        );
      }

      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Job name ${job.name} is not supported`);
    }
  }
}
