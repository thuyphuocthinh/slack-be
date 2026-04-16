import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { MailerService } from '@nestjs-modules/mailer';
import { RpcException } from '@nestjs/microservices';
import { NOTIFICATION_ERROR } from '@slack/constants/errors/notification.error';

describe('EmailService', () => {
  let service: EmailService;
  let mailerService: MailerService;

  const mockMailerService = () => ({
    sendMail: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: MailerService,
          useFactory: mockMailerService,
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    mailerService = module.get<MailerService>(MailerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendVerificationEmail', () => {
    const email = 'test@example.com';
    const code = '123456';

    it('should send verification email successfully', async () => {
      (mailerService.sendMail as jest.Mock).mockResolvedValue({});

      await expect(
        service.sendVerificationEmail(email, code),
      ).resolves.not.toThrow();
      expect(mailerService.sendMail).toHaveBeenCalledWith({
        to: email,
        subject: 'Verify your email',
        template: 'verification',
        context: { code },
      });
    });

    it('should throw RpcException if mailerService fails', async () => {
      (mailerService.sendMail as jest.Mock).mockRejectedValue(
        new Error('SMTP failure'),
      );

      await expect(service.sendVerificationEmail(email, code)).rejects.toThrow(
        RpcException,
      );
    });

    it('should log an error and throw NOTIFICATION_ERROR.SEND_VERIFICATION_EMAIL_FAILED on failure', async () => {
      (mailerService.sendMail as jest.Mock).mockRejectedValue(
        new Error('SMTP failure'),
      );

      try {
        await service.sendVerificationEmail(email, code);
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        expect(e.getError()).toEqual(
          NOTIFICATION_ERROR.SEND_VERIFICATION_EMAIL_FAILED,
        );
      }
    });
  });

  describe('sendResetPasswordEmail', () => {
    const email = 'test@example.com';
    const code = '654321';

    it('should send reset password email successfully', async () => {
      (mailerService.sendMail as jest.Mock).mockResolvedValue({});

      await expect(
        service.sendResetPasswordEmail(email, code),
      ).resolves.not.toThrow();
      expect(mailerService.sendMail).toHaveBeenCalledWith({
        to: email,
        subject: 'Reset your password',
        template: 'reset_password',
        context: { code },
      });
    });

    it('should throw RpcException if mailerService fails in sendResetPasswordEmail', async () => {
      (mailerService.sendMail as jest.Mock).mockRejectedValue(
        new Error('SMTP failure'),
      );

      await expect(service.sendResetPasswordEmail(email, code)).rejects.toThrow(
        RpcException,
      );
    });

    it('should throw correct error code on failure', async () => {
      (mailerService.sendMail as jest.Mock).mockRejectedValue(
        new Error('SMTP failure'),
      );

      try {
        await service.sendResetPasswordEmail(email, code);
      } catch (e) {
        expect(e.getError()).toEqual(
          NOTIFICATION_ERROR.SEND_RESET_PASSWORD_EMAIL_FAILED,
        );
      }
    });
  });
});
