import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './services/notification.service';
import { DatabaseModule } from '@slack/database';
import { MailerModule } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { join } from 'path';
import { I_MAIL_SERVICE } from './services/mail.interface';
import { SendgridService } from './services/sendgrid.service';
import { NodemailerService } from './services/nodemailer.service';

@Module({
  imports: [
    DatabaseModule,
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const port = config.get<number>('MAIL_PORT');

        return {
          transport: {
            host: config.get<string>('MAIL_HOST'),
            port,
            secure: false, // port 587 uses STARTTLS (secure: false)
            auth: {
              user: config.get<string>('MAIL_USER'),
              pass: config.get<string>('MAIL_PASSWORD'),
            },
          },
          defaults: {
            from: config.get<string>('MAIL_FROM'),
          },

          template: {
            dir: join(__dirname, 'templates'),
            adapter: new HandlebarsAdapter(),
            options: {
              strict: true,
            },
          },
        };
      },
    }),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NodemailerService,
    SendgridService,
    {
      provide: I_MAIL_SERVICE,
      useClass: NodemailerService,
    },
  ],
})
export class NotificationModule {}
