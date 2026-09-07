import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService, RegisterDto, OAuthClaims } from './auth.service';
import { verify, AccessClaims } from './jwt';
import { config } from '../config';

function bearer(req: Request): string {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() body: { identifier: string; password: string }) {
    return this.auth.login(body.identifier, body.password);
  }

  @Post('refresh')
  refresh(@Body() body: { refresh_token: string }) {
    return this.auth.rotateRefresh(body.refresh_token);
  }

  @Post('logout')
  logout(@Req() req: Request) {
    try {
      const claims = verify<AccessClaims>(bearer(req), config.accessSecret);
      return this.auth.logout(claims.sid);
    } catch {
      return { status: 'already_logged_out' };
    }
  }

  @Post('otp/request')
  requestOtp(@Body() body: { phone_number: string }) {
    return this.auth.requestOtp(body.phone_number);
  }

  @Post('otp/verify')
  verifyOtp(@Body() body: { phone_number: string; code: string }) {
    return this.auth.verifyOtp(body.phone_number, body.code);
  }

  @Post('oauth/:provider')
  oauth(@Body() claims: OAuthClaims) {
    return this.auth.oauthLogin(claims);
  }
}
