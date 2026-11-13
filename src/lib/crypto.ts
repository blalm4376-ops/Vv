export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function generateIdempotencyKey(prefix = 'op'): string {
  return `${prefix}_${Date.now()}_${generateUUID().slice(0, 12)}`;
}

export function getOrCreateDeviceId(): string {
  const key = 'smart_pos_trusted_device_id';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = `DEV-${generateUUID().slice(0, 8).toUpperCase()}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return 'DEV-LOCAL-01';
  }
}

/**
 * Generates Egypt ETA / ZATCA compatible TLV Base64 QR Payload
 * Tag 1: Seller Name, Tag 2: Tax Registration Number, Tag 3: Timestamp, Tag 4: Invoice Total, Tag 5: VAT Total
 */
export function buildEtaQrTlvBase64(params: {
  sellerName: string;
  taxNumber: string;
  timestamp: string;
  totalWithVat: string;
  vatAmount: string;
}): string {
  const encoder = new TextEncoder();
  const encodeField = (tag: number, value: string): Uint8Array => {
    const valBytes = encoder.encode(value);
    const out = new Uint8Array(2 + valBytes.length);
    out[0] = tag;
    out[1] = valBytes.length;
    out.set(valBytes, 2);
    return out;
  };

  const parts = [
    encodeField(1, params.sellerName),
    encodeField(2, params.taxNumber || '000000000'),
    encodeField(3, params.timestamp),
    encodeField(4, params.totalWithVat),
    encodeField(5, params.vatAmount),
  ];

  const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }

  let binary = '';
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(combined).toString('base64');
}

/**
 * Web Crypto AES-GCM encryption for local sensitive backup/session payloads
 */
export async function encryptSensitivePayload(plainText: string, secretPassphrase: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretPassphrase.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyMaterial, enc.encode(plainText));
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.length);
  let bin = '';
  for (let i = 0; i < combined.length; i++) bin += String.fromCharCode(combined[i]);
  return btoa(bin);
}

export async function decryptSensitivePayload(cipherBase64: string, secretPassphrase: string): Promise<string> {
  const enc = new TextEncoder();
  const bin = atob(cipherBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const iv = bytes.slice(0, 12);
  const data = bytes.slice(12);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretPassphrase.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keyMaterial, data);
  return new TextDecoder().decode(plainBuffer);
}
