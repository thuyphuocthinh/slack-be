import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entity/notification.entity';
import { AuditLog } from './entity/audit.entity';
import { NotificationController } from './notification.controller';
import { NotificationService } from './services/impl/notification.service';
import { AuditService } from './services/impl/audit.service';
import { DatabaseModule } from '@slack/database';
import { MailerModule } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { join } from 'path';
import { I_MAIL_SERVICE } from './services/mail.interface';
import { SendgridService } from './services/impl/sendgrid.service';
import { NodemailerService } from './services/impl/nodemailer.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { QueueModule, EQueueName } from '@slack/queue';
import { EmailProcessor } from './processors/email.processor';

@Module({
  imports: [
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.EMAIL_QUEUE]),
    DatabaseModule,
    TypeOrmModule.forFeature([Notification, AuditLog]),
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.USER_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.USER_TCP_PORT,
        },
      },
    ]),
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
    AuditService,
    NodemailerService,
    SendgridService,
    EmailProcessor,
    {
      provide: I_MAIL_SERVICE,
      useClass: NodemailerService,
    },
  ],
})
export class NotificationModule {}
