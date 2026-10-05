/**
 * Connects to the realtime gateway as a staff user and prints every event it
 * receives, so you can watch live updates while driving the REST API from
 * another terminal.
 *
 * Usage:
 *   node scripts/ws-smoke.ts <access-token> [wsUrl]
 *
 * Get <access-token> from POST /api/v1/auth/login's response body.
 * [wsUrl] defaults to http://localhost:3000 (matches the API's default port).
 */
import { io } from 'socket.io-client';

const token = process.argv[2];
if (!token) {
  console.error('Usage: node scripts/ws-smoke.ts <access-token> [wsUrl]');
  process.exit(1);
}
const url = process.argv[3] || 'http://localhost:3000';

console.log(`Connecting to ${url} ...`);
const socket = io(url, { auth: { token }, transports: ['websocket'] });

socket.on('connect', () => console.log(`[connected] socket id=${socket.id}`));
socket.on('connect_error', (err) => console.error('[connect_error]', err.message));
socket.on('disconnect', (reason) => console.log(`[disconnected] reason=${reason}`));
socket.on('disconnect_reason', (payload) => console.log('[disconnect_reason]', payload));
socket.on('shipment:updated', (payload) => console.log('[shipment:updated]', payload));
socket.on('shipment:assigned', (payload) => console.log('[shipment:assigned]', payload));

process.on('SIGINT', () => {
  socket.disconnect();
  process.exit(0);
});
