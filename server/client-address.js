import { isIP } from 'node:net';

// Only the local TLS proxy may supply a client address. It overwrites XFF.
export function clientAddress(request, trustProxy = process.env.MP_TRUST_PROXY) {
  const peer = request.socket.remoteAddress;
  if (trustProxy !== 'loopback' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return peer;
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded !== 'string' || !isIP(forwarded.trim())) return peer;
  return forwarded.trim();
}
