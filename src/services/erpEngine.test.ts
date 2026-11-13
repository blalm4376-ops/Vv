import { describe, it, expect } from 'vitest';
import {
  computeSaleTotals,
  roundMoney,
  verifyJournalBalance,
} from './erpEngine';
import {
  buildEtaQrTlvBase64,
  encryptSensitivePayload,
  decryptSensitivePayload,
  generateIdempotencyKey,
} from '../lib/crypto';

describe('Smart POS ERP Core Engine Tests', () => {
  it('computes Egyptian 14% VAT and invoice discounts accurately', () => {
    const totals = computeSaleTotals(
      [
        { qty: 2, price: 150, discount: 20, taxRate: 14 },
        { qty: 1, price: 100, discount: 0, taxRate: 0 },
      ],
      10,
      true
    );
    // Item 1: 300 - 20 = 280, tax = 280 * 0.14 = 39.2
    // Item 2: 100, tax = 0
    // Subtotal = 400, Total Discount = 30, Net = 370, Tax = 39.2, Grand = 409.2
    expect(totals.subtotal).toBe(400);
    expect(totals.discountTotal).toBe(30);
    expect(totals.taxTotal).toBe(39.2);
    expect(totals.grandTotal).toBe(409.2);
  });

  it('enforces Double Entry Accounting balance (Debit == Credit)', () => {
    const balanced = verifyJournalBalance([
      { accountId: '1', accountCode: '1101', accountName: 'نقدية', debit: 1140, credit: 0 },
      { accountId: '2', accountCode: '4101', accountName: 'مبيعات', debit: 0, credit: 1000 },
      { accountId: '3', accountCode: '2201', accountName: 'ضريبة', debit: 0, credit: 140 },
    ]);
    expect(balanced.balanced).toBe(true);
    expect(balanced.totalDebit).toBe(1140);
    expect(balanced.totalCredit).toBe(1140);

    const unbalanced = verifyJournalBalance([
      { accountId: '1', accountCode: '1101', accountName: 'نقدية', debit: 500, credit: 0 },
      { accountId: '2', accountCode: '4101', accountName: 'مبيعات', debit: 0, credit: 400 },
    ]);
    expect(unbalanced.balanced).toBe(false);
  });

  it('generates valid ETA TLV Base64 QR payload', () => {
    const b64 = buildEtaQrTlvBase64({
      sellerName: 'Nile Smart Trading',
      taxNumber: '310485920',
      timestamp: '2026-11-12T12:00:00Z',
      totalWithVat: '228.00',
      vatAmount: '28.00',
    });
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    expect(decoded).toContain('Nile Smart Trading');
    expect(decoded).toContain('310485920');
    expect(decoded).toContain('228.00');
  });

  it('generates unique idempotency keys and rounds money cleanly', () => {
    const k1 = generateIdempotencyKey('sale');
    const k2 = generateIdempotencyKey('sale');
    expect(k1).not.toBe(k2);
    expect(roundMoney(10.005)).toBe(10.01);
  });

  it('encrypts and decrypts local sensitive payloads with AES-GCM', async () => {
    const secret = 'Passphrase123';
    const payload = JSON.stringify({ store: 'Nile', cash: 48500 });
    const encrypted = await encryptSensitivePayload(payload, secret);
    expect(encrypted).not.toContain('48500');
    const decrypted = await decryptSensitivePayload(encrypted, secret);
    expect(decrypted).toBe(payload);
  });
});
