import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard, minutes } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator.js';
import { AnyAuthenticated } from '../../../common/decorators/any-authenticated.decorator.js';
import { CustomerOnly } from '../../../common/decorators/customer-only.decorator.js';
import { CurrentCustomer, type CustomerPrincipal } from '../../../common/decorators/current-customer.decorator.js';
import { PortalAuthService, type PortalAuthResult } from '../service/portal-auth.service.js';
import { PORTAL_REFRESH_COOKIE_NAME, PORTAL_REFRESH_COOKIE_PATH, PORTAL_REFRESH_TOKEN_TTL_MS } from '../service/portal-auth.constants.js';
import { AcceptInviteDto } from '../dto/accept-invite.dto.js';
import { PortalLoginDto } from '../dto/portal-login.dto.js';
import { ForgotPasswordDto } from '../dto/forgot-password.dto.js';
import { ResetPasswordDto } from '../dto/reset-password.dto.js';

// 5 requests/minute per IP on the guessing/enumeration-relevant routes
// (login, accept-invite, forgot-password, reset-password). A legitimate
// user very rarely retries a password or a link more than a couple of
// times in a minute; 5/min caps credential-stuffing or token-guessing at
// ~7,200 attempts/day — far too slow to brute-force an 8+ char bcrypt
// password or a 32-byte random token, which is what actually matters here.
const SENSITIVE_ROUTE_THROTTLE = { default: { limit: 5, ttl: minutes(1) } };

@Controller('portal/auth')
export class PortalAuthController {
  constructor(private readonly portalAuthService: PortalAuthService) {}

  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie(PORTAL_REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: PORTAL_REFRESH_COOKIE_PATH,
      maxAge: PORTAL_REFRESH_TOKEN_TTL_MS,
    });
  }

  private respondWithAuth(res: Response, result: PortalAuthResult) {
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(SENSITIVE_ROUTE_THROTTLE)
  @Post('accept-invite')
  @HttpCode(200)
  async acceptInvite(@Body() dto: AcceptInviteDto) {
    await this.portalAuthService.acceptInvite(dto.token, dto.password);
    return { success: true };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(SENSITIVE_ROUTE_THROTTLE)
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: PortalLoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.portalAuthService.login(dto.email, dto.password);
    return this.respondWithAuth(res, result);
  }

  // Not throttled: rotation is already atomic + reuse-detected, and this
  // isn't a guessing surface (a valid session cookie is required to do
  // anything at all here).
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[PORTAL_REFRESH_COOKIE_NAME];
    if (!token) throw new UnauthorizedException('Missing refresh token');
    const result = await this.portalAuthService.refresh(token);
    return this.respondWithAuth(res, result);
  }

  // @Public(): logout authenticates itself via the refresh cookie, not a
  // Bearer token — same pattern as the staff auth module.
  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[PORTAL_REFRESH_COOKIE_NAME];
    await this.portalAuthService.logout(token);
    res.clearCookie(PORTAL_REFRESH_COOKIE_NAME, { path: PORTAL_REFRESH_COOKIE_PATH });
    return { success: true };
  }

  @CustomerOnly()
  @AnyAuthenticated()
  @Get('me')
  async me(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.portalAuthService.getMe(customer.sub);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(SENSITIVE_ROUTE_THROTTLE)
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.portalAuthService.forgotPassword(dto.email);
    return { success: true };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(SENSITIVE_ROUTE_THROTTLE)
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.portalAuthService.resetPassword(dto.token, dto.password);
    return { success: true };
  }
}
