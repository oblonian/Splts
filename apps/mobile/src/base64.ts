// Hermes has no btoa/atob and no Buffer; hand-rolled base64 keeps the
// persistence layer dependency-free.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET[i]!] = i;

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2]!;
    out += ALPHABET[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]!;
    out += b1 === undefined ? '=' : ALPHABET[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]!;
    out += b2 === undefined ? '=' : ALPHABET[b2 & 63]!;
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outIdx = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = LOOKUP[clean[i]!]!;
    const c1 = LOOKUP[clean[i + 1]!] ?? 0;
    const c2 = LOOKUP[clean[i + 2]!];
    const c3 = LOOKUP[clean[i + 3]!];
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
    if (c2 !== undefined) out[outIdx++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (c3 !== undefined) out[outIdx++] = ((c2! & 3) << 6) | c3;
  }
  return out;
}
