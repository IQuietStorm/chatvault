import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { MediaService } from './media.service';
import { verify, AccessClaims } from '../auth/jwt';
import { config } from '../config';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('presign')
  presignPut(
    @Req() req: Request,
    @Body() body: { mime_type: string; size_bytes: number; view_policy?: 'standard' | 'view_once' },
  ) {
    const claims = verify<AccessClaims>(req.headers.authorization!.slice(7), config.accessSecret);
    return this.media.presignPut(claims.sub, body.mime_type, body.size_bytes, body.view_policy);
  }

  @Get(':id/presigned')
  presignGet(@Param('id') id: string) {
    return this.media.presignGet(id);
  }
}
