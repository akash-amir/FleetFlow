import { SetMetadata } from '@nestjs/common';

export const ANY_AUTHENTICATED_KEY = 'anyAuthenticated';

/** Marks a route as needing only a valid login — no specific permission required (e.g. GET /auth/me). */
export const AnyAuthenticated = () => SetMetadata(ANY_AUTHENTICATED_KEY, true);
