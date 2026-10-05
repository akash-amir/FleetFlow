import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@prisma/client';

/** Shape of the JWT payload JwtAuthGuard attaches to the request as `user`. */
export interface AuthUser {
  sub: number;
  email: string;
  role: Role;
}

/** Pulls the authenticated user (set by JwtAuthGuard) off the request. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
