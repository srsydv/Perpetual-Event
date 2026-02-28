/**
 * Unit tests: validation, address/size/expiry parsing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseAddress, parseBigInt, parseExpiry, validateOrderBody } from '../src/validation.js';

describe('validation', () => {
  it('parseAddress rejects empty and invalid', () => {
    assert.ok(!parseAddress('').ok);
    assert.ok(!parseAddress('0xinvalid').ok);
    assert.ok(!parseAddress(null).ok);
  });

  it('parseAddress accepts valid checksummed address', () => {
    const res = parseAddress('0xf69F75EB0c72171AfF58D79973819B6A3038f39f');
    assert.ok(res.ok);
    assert.strictEqual(res.value, '0xf69F75EB0c72171AfF58D79973819B6A3038f39f');
  });

  it('parseBigInt accepts string and number', () => {
    assert.ok(parseBigInt('100').ok && parseBigInt('100').value === 100n);
    assert.ok(parseBigInt(50).ok && parseBigInt(50).value === 50n);
    assert.ok(!parseBigInt(-1).ok);
  });

  it('parseExpiry rejects past expiry', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.ok(!parseExpiry(now - 1, now).ok);
  });

  it('validateOrderBody requires maker, market, side', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.ok(!validateOrderBody({}, now).ok);
    assert.ok(!validateOrderBody({ maker: '0xf69F75EB0c72171AfF58D79973819B6A3038f39f' }, now).ok);
    const full = {
      maker: '0xf69F75EB0c72171AfF58D79973819B6A3038f39f',
      market: '0x799a5570318c0C5Fcfd09b0f573335B5aa8d85Ff',
      side: 'long',
      limitPrice: '50',
      size: '100',
      nonce: 0,
      expiry: now + 86400,
    };
    const v = validateOrderBody(full, now);
    assert.ok(v.ok);
    assert.strictEqual(v.value.side, 'long');
    assert.strictEqual(v.value.limitPrice, 50n);
  });
});
