const fs = require('fs');

const files = [
  { path: 'apps/api-gateway/src/channel/channel.service.ts', name: 'ChannelService' },
  { path: 'apps/api-gateway/src/message/message.service.ts', name: 'MessageService' },
  { path: 'apps/api-gateway/src/notification/notification.service.ts', name: 'NotificationService' },
  { path: 'apps/api-gateway/src/user/user.service.ts', name: 'UserService' },
  { path: 'apps/api-gateway/src/video-call/video-call.service.ts', name: 'VideoCallService' },
  { path: 'apps/api-gateway/src/webhook-receiver/webhook-receiver.service.ts', name: 'WebhookReceiverService' },
];

for (const { path, name } of files) {
  let content = fs.readFileSync(path, 'utf8');

  if (!content.includes('MicroserviceErrorHandler')) {
    content = content.replace("import { firstValueFrom } from 'rxjs';", "import { firstValueFrom } from 'rxjs';\nimport { MicroserviceErrorHandler } from '../common/microservice_error.handler';");
  }

  const parts = content.split('async ');
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const match = part.match(/^([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/);
    if (match) {
      const methodName = match[1];
      parts[i] = part.replace(/await\s+firstValueFrom\(([\s\S]*?)\);/g, 
        `MicroserviceErrorHandler.handleAsyncCall(() => firstValueFrom($1), '${methodName}', '${name}');`
      );
    }
  }
  content = parts.join('async ');

  fs.writeFileSync(path, content, 'utf8');
  console.log(`Refactored ${path}`);
}
