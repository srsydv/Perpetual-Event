/**
 * EIP-712 order signature verification. Matches contract domain and type hashes.
 */
import { verifyTypedData } from 'ethers';

const DOMAIN_NAME = 'EventPerpetual';
const DOMAIN_VERSION = '1';

/**
 * Verify order signature. Supports V1 (no salt) and V2 (with salt).
 * @param {object} params - { marketAddress, chainId, maker, price, size, isLong, nonce, expiry, salt?, signature }
 * @returns {boolean} true if signature recovers to maker
 */
export function verifyOrderSignature(params) {
  const {
    marketAddress,
    chainId,
    maker,
    price,
    size,
    isLong,
    nonce,
    expiry,
    salt,
    signature,
  } = params;
  if (!signature || typeof signature !== 'string' || !marketAddress || maker == null) return false;
  try {
    const domain = {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: Number(chainId),
      verifyingContract: marketAddress,
    };
    const hasSalt = salt != null && salt !== '0x' && salt !== '';
    const types = hasSalt
      ? { Order: [{ name: 'maker', type: 'address' }, { name: 'price', type: 'uint256' }, { name: 'size', type: 'uint256' }, { name: 'isLong', type: 'bool' }, { name: 'nonce', type: 'uint256' }, { name: 'expiry', type: 'uint256' }, { name: 'salt', type: 'bytes32' }] }
      : { Order: [{ name: 'maker', type: 'address' }, { name: 'price', type: 'uint256' }, { name: 'size', type: 'uint256' }, { name: 'isLong', type: 'bool' }, { name: 'nonce', type: 'uint256' }, { name: 'expiry', type: 'uint256' }] };
    const value = hasSalt
      ? { maker, price: BigInt(price), size: BigInt(size), isLong: Boolean(isLong), nonce: BigInt(nonce), expiry: BigInt(expiry), salt: normalizeSalt(salt) }
      : { maker, price: BigInt(price), size: BigInt(size), isLong: Boolean(isLong), nonce: BigInt(nonce), expiry: BigInt(expiry) };
    const sig = signature.startsWith('0x') ? signature : '0x' + signature;
    const recovered = verifyTypedData(domain, types, value, sig);
    return recovered.toLowerCase() === maker.toLowerCase();
  } catch {
    return false;
  }
}

function normalizeSalt(s) {
  if (typeof s !== 'string') return '0x' + '0'.repeat(64);
  if (s.startsWith('0x')) return s.length === 66 ? s : '0x' + s.slice(2).padStart(64, '0');
  return '0x' + String(s).padStart(64, '0');
}
