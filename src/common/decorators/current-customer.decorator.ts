import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Shape of the JWT payload JwtAuthGuard attaches to the request as `user` on a @CustomerOnly() route. */
export interface CustomerPrincipal {
  kind: 'customer';
  /** CustomerUser.id */
  sub: number;
  customerId: number;
}

/** Pulls the authenticated customer (set by JwtAuthGuard on a @CustomerOnly() route) off the request. */
export const CurrentCustomer = createParamDecorator((_data: unknown, ctx: ExecutionContext): CustomerPrincipal => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
