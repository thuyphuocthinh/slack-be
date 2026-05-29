export const I_MAIL_SERVICE = 'IMailService';

export interface IMailService {
  sendEmail(
    to: string,
    subject: string,
    template: string,
    context: Record<string, string>,
  ): Promise<void>;

  sendVerificationEmail(email: string, code: string): Promise<void>;

  sendResetPasswordEmail(email: string, code: string): Promise<void>;

  sendUnrecognizedDeviceEmail(
    email: string,
    ipAddress?: string,
    userAgent?: string,
    time?: string,
  ): Promise<void>;
}
