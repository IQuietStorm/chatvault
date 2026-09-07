import { Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { ChatController } from './chat/chat.controller';
import { ChatGateway } from './chat/chat.gateway';
import { ChatService } from './chat/chat.service';
import { MediaController } from './media/media.controller';
import { MediaService } from './media/media.service';
import { CallsGateway } from './calls/calls.gateway';
import { CallsService } from './calls/calls.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

@Module({
  controllers: [AuthController, ChatController, MediaController, UsersController],
  providers: [AuthService, ChatService, ChatGateway, MediaService, CallsService, CallsGateway, UsersService],
})
export class AppModule {}
