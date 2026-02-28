/**
 * Request validation: addresses, sizes, expiries, max values.
 */
import { getAddress } from 'ethers';

const MAX_SIZE = 2n ** 128n - 1n;
const MAX_PRICE = 2n ** 128n - 1n;
const MIN_EXPIRY_OFFSET = 0;
const MAX_EXPIRY_OFFSET = 365 * 24 * 3600; // 1 year

export function parseAddress(value, fieldName = 'address') {
  if (value == null || typeof value !== 'string') return { ok: false, error: `${fieldName} required` };
  try {
    const addr = getAddress(value.trim());
    return { ok: true, value: addr };
  } catch {
    return { ok: false, error: `Invalid ${fieldName}: must be checksummed address` };
  }
}

export function parseBigInt(value, fieldName, max = MAX_SIZE) {
  if (value == null && value !== 0) return { ok: false, error: `${fieldName} required` };
  try {
    const n = typeof value === 'string' ? BigInt(value) : BigInt(Number(value));
    if (n < 0n) return { ok: false, error: `${fieldName} must be non-negative` };
    if (max != null && n > max) return { ok: false, error: `${fieldName} exceeds max` };
    return { ok: true, value: n };
  } catch {
    return { ok: false, error: `Invalid ${fieldName}` };
  }
}

export function parseExpiry(expiry, nowTs, defaultOffset = 86400) {
  const ts = expiry != null ? Number(expiry) : nowTs + defaultOffset;
  if (Number.isNaN(ts) || ts < nowTs) return { ok: false, error: 'Order expired or invalid expiry' };
  if (ts > nowTs + MAX_EXPIRY_OFFSET) return { ok: false, error: 'Expiry too far in future' };
  return { ok: true, value: ts };
}

export function validateOrderBody(body, nowTs) {
  const { maker, market, side, limitPrice, size, nonce, expiry, salt, signature } = body;
  const makerRes = parseAddress(maker, 'maker');
  if (!makerRes.ok) return makerRes;
  const marketRes = parseAddress(market, 'market');
  if (!marketRes.ok) return marketRes;
  if (side !== 'long' && side !== 'short' && side !== true && side !== false) {
    return { ok: false, error: 'side must be long or short' };
  }
  const priceRes = parseBigInt(limitPrice, 'limitPrice', MAX_PRICE);
  if (!priceRes.ok) return priceRes;
  const sizeRes = parseBigInt(size, 'size');
  if (!sizeRes.ok) return sizeRes;
  if (sizeRes.value === 0n) return { ok: false, error: 'size must be positive' };
  const nonceNum = nonce != null ? Number(nonce) : 0;
  if (Number.isNaN(nonceNum) || nonceNum < 0) return { ok: false, error: 'Invalid nonce' };
  const expiryRes = parseExpiry(expiry, nowTs);
  if (!expiryRes.ok) return expiryRes;
  return {
    ok: true,
    value: {
      maker: makerRes.value,
      market: marketRes.value,
      side: side === 'long' || side === true ? 'long' : 'short',
      limitPrice: priceRes.value,
      size: sizeRes.value,
      nonce: nonceNum,
      expiry: expiryRes.value,
      salt: salt ?? '0x',
      signature: signature ?? '',
    },
  };
}
