import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, cert, App } from 'firebase-admin/app';
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private firebaseApp: App;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    let privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Firebase Admin credentials missing in environment variables. FCM notifications will be skipped.',
      );
      return;
    }

    // Xử lý xuống dòng cho private key trong biến môi trường
    privateKey = privateKey.replace(/\\n/g, '\n');

    try {
      this.firebaseApp = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      this.logger.log('Khởi tạo Firebase Admin SDK thành công.');
    } catch (error) {
      this.logger.error('Lỗi khởi tạo Firebase Admin SDK:', error.stack);
    }
  }

  async sendPushNotification(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.firebaseApp) {
      this.logger.warn('Firebase App chưa được khởi tạo. Bỏ qua gửi push notification.');
      return;
    }

    if (!tokens || tokens.length === 0) {
      return;
    }

    const message: MulticastMessage = {
      tokens,
      notification: {
        title,
        body,
      },
      data,
    };

    try {
      const response = await getMessaging(this.firebaseApp).sendEachForMulticast(message);
      this.logger.log(
        `Đã gửi push notification. Thành công: ${response.successCount}, Thất bại: ${response.failureCount}`,
      );

      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            this.logger.error(
              `Thất bại khi gửi push notification đến token ${tokens[idx]}: ${resp.error?.message}`,
            );
          }
        });
      }
    } catch (error) {
      this.logger.error('Lỗi khi gửi multicast push notification:', error.stack);
    }
  }
}
