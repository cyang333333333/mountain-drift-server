import test from 'node:test';
import assert from 'node:assert/strict';
import { clientAddress } from '../server/client-address.js';

const request = (peer, forwarded) => ({ socket: { remoteAddress: peer }, headers: { 'x-forwarded-for': forwarded } });
test('Oracle TLS proxy keeps individual client connection limits', () => {
  assert.equal(clientAddress(request('127.0.0.1', '203.0.113.1'), 'loopback'), '203.0.113.1');
  assert.equal(clientAddress(request('::ffff:127.0.0.1', '2001:db8::1'), 'loopback'), '2001:db8::1');
  assert.notEqual(clientAddress(request('127.0.0.1', '203.0.113.1'), 'loopback'), clientAddress(request('127.0.0.1', '203.0.113.2'), 'loopback'));
});
test('public connections cannot spoof their address or supply a forwarded chain', () => {
  assert.equal(clientAddress(request('203.0.113.1', '203.0.113.2'), 'loopback'), '203.0.113.1');
  assert.equal(clientAddress(request('127.0.0.1', '203.0.113.2'), 'off'), '127.0.0.1');
  for (const header of ['203.0.113.2, 203.0.113.3', 'invalid', undefined]) {
    assert.equal(clientAddress(request('127.0.0.1', header), 'loopback'), '127.0.0.1');
  }
});
