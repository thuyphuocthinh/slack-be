import { Injectable, Logger, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class SocketService {
  private readonly logger = new Logger(SocketService.name);

  // Key: channelId, Value: number of active users on THIS server instance
  private channelRefCount = new Map<string, number>();

  // Callback map to handle messages from Redis
  private channelCallbacks = new Map<string, (data: any) => void>();

  // Timeout map for graceful unsubscription
  private unsubscribeTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject('REDIS_SUBSCRIBER') private readonly redisSub: Redis,
    @Inject('REDIS_PUBLISHER') private readonly redisPub: Redis,
  ) {
    this.initRedisListener();
  }

  private initRedisListener() {
    this.redisSub.on('message', (channel, message) => {
      const callback = this.channelCallbacks.get(channel);
      if (callback) {
        try {
          const data = JSON.parse(message);
          callback(data);
        } catch (e) {
          this.logger.error(
            `Failed to parse message from channel ${channel}: ${e.message}`,
          );
        }
      }
    });
  }

  async subscribeChannel(channelId: string, onMessage: (data: any) => void) {
    // If there is a pending unsubscription for this channel, cancel it
    if (this.unsubscribeTimeouts.has(channelId)) {
      clearTimeout(this.unsubscribeTimeouts.get(channelId));
      this.unsubscribeTimeouts.delete(channelId);
      this.logger.log(
        `Graceful Unsubscribe: Cancelled pending unsubscribe for [${channelId}]`,
      );
    }

    const currentCount = this.channelRefCount.get(channelId) || 0;

    // Register the callback for this channel (local to this server instance)
    this.channelCallbacks.set(channelId, onMessage);

    if (currentCount === 0) {
      // First user on this server instance interested in this channel
      this.logger.log(
        `Reference Counting: Subscribing to Redis channel [${channelId}]`,
      );
      await this.redisSub.subscribe(channelId);
    }

    this.channelRefCount.set(channelId, currentCount + 1);
  }

  async unsubscribeChannel(channelId: string) {
    const currentCount = this.channelRefCount.get(channelId) || 0;

    if (currentCount <= 1) {
      // Last user on this server instance leaving the channel
      // We use a graceful timeout to handle flapping connections
      if (this.unsubscribeTimeouts.has(channelId)) return;

      this.logger.log(
        `Graceful Unsubscribe: Scheduled unsubscribe for [${channelId}] in 5s`,
      );

      const timeout = setTimeout(async () => {
        this.logger.log(
          `Graceful Unsubscribe: Finalizing unsubscribe for [${channelId}]`,
        );
        await this.redisSub.unsubscribe(channelId);
        this.channelRefCount.delete(channelId);
        this.channelCallbacks.delete(channelId);
        this.unsubscribeTimeouts.delete(channelId);
      }, 5000);

      this.unsubscribeTimeouts.set(channelId, timeout);
    } else {
      this.channelRefCount.set(channelId, currentCount - 1);
    }
  }

  /**
   * Helper to publish events to Redis
   */
  async publishEvent(channelId: string, data: any) {
    await this.redisPub.publish(channelId, JSON.stringify(data));
  }
}

/*
In the same redis server
- Redis pub/sub => event to redis listener (listen all channelId) in Socket-gateway => callback function in Socket-gateway => 
callback defintion socket sends back to client

- Just need only one redis server and multiple server sockets (communicate to each other via redis io adapter), pub to 1 redis and multiple socket server
can listen => send message to client (same channel)

*/
