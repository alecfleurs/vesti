// AES-GCM with a PBKDF2-derived key. The same format is decrypted in the browser with WebCrypto.
// File layout: [12-byte IV][ciphertext of gzip(JSON)].

import { gzipSync } from 'node:zlib';

const { subtle } = globalThis.crypto;
export const ITERATIONS = 250000;

export function randomSalt() {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(16))).toString('base64');
}

export async function deriveKey(passphrase, saltB64, iterations = ITERATIONS) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(saltB64, 'base64'), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJson(key, obj) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plain = gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 });
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

// Raw bytes (audio): [12-byte IV][ciphertext], no gzip (MP3 doesn't compress).
export async function encryptBytes(key, bytes) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
