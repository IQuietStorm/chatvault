import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService, RegisterDto } from './auth.service';
import { verify, AccessClaims } from './jwt';
import { config } from '../config';
import { OAuthProvider, OAuthService } from './oauth.service';

function bearer(req: Request): string {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly oauthProvider: OAuthService) {}

  @Get(':provider/login')
  oauthLogin(@Param('provider') provider: OAuthProvider, @Res() res: Response) {
    if (provider !== 'google' && provider !== 'apple') return res.status(404).send('Unknown OAuth provider');
    return res.redirect(this.oauthProvider.authorizationUrl(provider));
  }

  @Get(':provider/callback')
  async oauthCallback(
    @Param('provider') provider: OAuthProvider,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    return this.finishOAuth(provider, code, state, res);
  }

  @Post(':provider/callback')
  async oauthPostCallback(
    @Param('provider') provider: OAuthProvider,
    @Body() body: { code?: string; state?: string; error?: string },
    @Res() res: Response,
  ) {
    return this.finishOAuth(provider, body.code ?? '', body.state ?? '', res, body.error);
  }

  private async finishOAuth(provider: OAuthProvider, code: string, state: string, res: Response, providerError?: string) {
    if (provider !== 'google' && provider !== 'apple') return res.status(404).send('Unknown OAuth provider');
    try {
      if (providerError) throw new Error(providerError);
      if (!code || !state) throw new Error('OAuth callback is missing code or state');
      const profile = await this.oauthProvider.exchange(provider, code, state);
      const session = await this.auth.oauthLogin(profile);
      const fragment = new URLSearchParams({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        user: JSON.stringify(session.user),
      });
      return res.redirect(`${config.oauth.clientUrl.replace(/\/$/, '')}/#oauth=${fragment}`);
    } catch (error: any) {
      const message = error?.message ?? 'OAuth sign-in failed';
      return res.redirect(`${config.oauth.clientUrl.replace(/\/$/, '')}/#oauth_error=${encodeURIComponent(message)}`);
    }
  }

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

}
