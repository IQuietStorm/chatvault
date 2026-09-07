import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { AppModule } from './app.module';
import { config } from './config';

/** Scale-out: Redis pub/sub adapter routes room events across Socket.IO nodes. */
export class RedisIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: any) {
    const pub = new Redis(config.redisUrl);
    const sub = pub.duplicate();
    const server = super.createIOServer(port, options);
    server.adapter(createAdapter(pub, sub));
    return server;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: { origin: true, credentials: true } });
  app.useWebSocketAdapter(new RedisIoAdapter(app));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  await app.listen(config.port);
  console.log(`ChatVault API + Socket.IO listening on :${config.port}`);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
