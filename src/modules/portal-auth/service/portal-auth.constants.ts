export const PORTAL_REFRESH_COOKIE_NAME = 'portal_refresh_token'; // distinct from staff's 'refresh_token'
export const PORTAL_REFRESH_COOKIE_PATH = '/api/v1/portal/auth'; // distinct from staff's '/api/v1/auth'
export const PORTAL_REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, same as staff
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
