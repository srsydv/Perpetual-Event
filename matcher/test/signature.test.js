/**
 * Unit tests: EIP-712 order signature verification (must match contract).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Wallet } from 'ethers';
import { verifyOrderSignature } from '../src/auth/verifyOrderSignature.js';

const wallet = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

describe('verifyOrderSignature', () => {
  const domain = {
    name: 'EventPerpetual',
    version: '1',
    chainId: 11155111,
    verifyingContract: '0x799a5570318c0C5Fcfd09b0f573335B5aa8d85Ff',
  };
  const typesV1 = {
    Order: [
      { name: 'maker', type: 'address' },
      { name: 'price', type: 'uint256' },
      { name: 'size', type: 'uint256' },
      { name: 'isLong', type: 'bool' },
      { name: 'nonce', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
  };
  const valueV1 = {
    maker: wallet.address,
    price: 50n * 10n ** 18n,
    size: 100n * 10n ** 18n,
    isLong: true,
    nonce: 0n,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 86400),
  };

  it('accepts valid V1 signature', async () => {
    const sig = await wallet.signTypedData(domain, typesV1, valueV1);
    const ok = verifyOrderSignature({
      marketAddress: domain.verifyingContract,
      chainId: domain.chainId,
      maker: wallet.address,
      price: valueV1.price,
      size: valueV1.size,
      isLong: true,
      nonce: 0,
      expiry: valueV1.expiry,
      signature: sig,
    });
    assert.strictEqual(ok, true);
  });

  it('rejects wrong signer', async () => {
    const sig = await wallet.signTypedData(domain, typesV1, valueV1);
    const ok = verifyOrderSignature({
      marketAddress: domain.verifyingContract,
      chainId: domain.chainId,
      maker: '0x0000000000000000000000000000000000000001',
      price: valueV1.price,
      size: valueV1.size,
      isLong: true,
      nonce: 0,
      expiry: valueV1.expiry,
      signature: sig,
    });
    assert.strictEqual(ok, false);
  });

  it('rejects empty signature', () => {
    assert.strictEqual(verifyOrderSignature({ ...valueV1, marketAddress: domain.verifyingContract, chainId: domain.chainId, signature: '' }), false);
  });
});
