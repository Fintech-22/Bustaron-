import { describe, expect, it } from 'vitest';
import { computeTxHash, ledgerTxHash, sha256Hex } from '../services/txHash';
import type { CreditLedgerEntry } from '../types/domain';

/**
 * The offline-replay transaction hash must be a REAL SHA-256, not a placeholder
 * string, so the ledger's tx hashes are verifiable. These vectors are the
 * published FIPS 180-4 examples.
 */
describe('sha256Hex (FIPS 180-4 test vectors)', () => {
  it('hashes the canonical short vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes an input spanning many 64-byte blocks', () => {
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});

describe('computeTxHash', () => {
  it('is deterministic and 64 lower-case hex characters', () => {
    const first = computeTxHash(['bustaron', 42]);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(computeTxHash(['bustaron', 42])).toBe(first);
  });

  it('separates fields so concatenation cannot collide', () => {
    expect(computeTxHash(['ab', 'c'])).not.toBe(computeTxHash(['a', 'bc']));
  });
});

describe('ledgerTxHash', () => {
  const base: Omit<CreditLedgerEntry, 'txHash'> = {
    id: 'ledger-1',
    walletId: 'wallet-harbour',
    deltaCredits: 40,
    reason: 'Escrow for corridor bid',
    atIso: '2026-09-24T12:40:00.000Z',
  };

  it('produces a 64-hex digest that changes with any signed field', () => {
    const hash = ledgerTxHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ledgerTxHash({ ...base, deltaCredits: 41 })).not.toBe(hash);
    expect(ledgerTxHash({ ...base, id: 'ledger-2' })).not.toBe(hash);
    expect(ledgerTxHash({ ...base, walletId: 'wallet-urban' })).not.toBe(hash);
  });
});
