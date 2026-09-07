import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ChatService } from './chat.service';
import { verify, AccessClaims } from '../auth/jwt';
import { config } from '../config';

@Controller('conversations')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(@Req() req: Request, @Query('limit') limit?: string) {
    const claims = verify<AccessClaims>(req.headers.authorization!.slice(7), config.accessSecret);
    return this.chat.listForUser(claims.sub, Number(limit ?? 50));
  }

  @Get(':id/messages')
  history(@Param('id') id: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    return this.chat.history(id, before, Number(limit ?? 50));
  }
}
