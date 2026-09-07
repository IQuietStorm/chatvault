import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { Request } from 'express';
import { verify, AccessClaims } from '../auth/jwt';
import { config } from '../config';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  private uid(req: Request): string {
    return verify<AccessClaims>(req.headers.authorization!.slice(7), config.accessSecret).sub;
  }

  @Get('me')
  me(@Req() req: Request) {
    return this.users.profile(this.uid(req));
  }

  @Patch('me')
  update(@Req() req: Request, @Body() body: { username?: string; avatar_url?: string }) {
    return this.users.update(this.uid(req), body);
  }

  @Patch('me/preferences')
  preferences(@Req() req: Request, @Body() body: { theme?: string; chat_wallpaper_url?: string }) {
    return this.users.upsertPreferences(this.uid(req), body);
  }
}
