import Transport = require('winston-transport');
import * as winston from 'winston';

interface TelegramTransportOptions extends Transport.TransportStreamOptions {
  botToken: string;
  chatId: string;
  format?: winston.Logform.Format;
}

export class TelegramTransport extends Transport {
  private botToken: string;
  private chatId: string;
  private queue: string[] = [];
  private isProcessing = false;

  constructor(opts: TelegramTransportOptions) {
    super(opts);
    this.botToken = opts.botToken;
    this.chatId = opts.chatId;
  }

  log(info: any, callback: () => void) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // Chỉ bắn thông báo với lỗi (error)
    if (info.level === 'error') {
      const message = this.formatMessage(info);
      this.queue.push(message);
      this.processQueue();
    }

    callback();
  }

  private formatMessage(info: any): string {
    const timestamp = info.timestamp || new Date().toISOString();
    // Winston truyền meta từ Logger của NestJS
    const appName = info.appName || 'Slack-BE';
    const context = info.context || 'Unknown Context';
    const errorMessage = info.message || 'Unknown Error';
    
    // NestJS thường lưu stack trace vào mảng splat hoặc thuộc tính stack/trace
    let stackTrace = info.stack || info.trace || '';
    if (!stackTrace && info[Symbol.for('splat')]) {
      stackTrace = info[Symbol.for('splat')].join('\\n');
    }

    // Giới hạn độ dài Stack Trace để không bị Telegram từ chối (Max 4096 ký tự)
    if (stackTrace && stackTrace.length > 2000) {
      stackTrace = stackTrace.substring(0, 2000) + '\\n... (truncated)';
    }

    // Escape ký tự HTML để dùng parse_mode HTML của Telegram
    const escapeHtml = (text: string) => {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    };

    return `🚨 <b>[${escapeHtml(appName)}] 🔥 CRITICAL ERROR</b>\n<b>Context:</b> ${escapeHtml(context)}\n<b>Time:</b> ${timestamp}\n\n<b>Message:</b>\n${escapeHtml(errorMessage)}\n\n<b>🔍 Stack Trace:</b>\n<pre>${escapeHtml(stackTrace || 'No stack trace available')}</pre>`;
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const message = this.queue.shift();
      if (!message) continue;

      try {
        // Dùng Fetch API (có sẵn trong Node 18+) để không phụ thuộc Axios
        await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: this.chatId,
            text: message,
            parse_mode: 'HTML',
          }),
        });
        
        // Tránh Spam Rate Limit của Telegram (Tối đa 20 tin/phút cho Group)
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error('[TelegramTransport] Lỗi khi gửi tin nhắn tới Telegram:', error);
      }
    }

    this.isProcessing = false;
  }
}
