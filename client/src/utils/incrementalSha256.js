// Small dependency-free incremental SHA-256 implementation used only for
// whole scientific-file fingerprints. It processes bounded chunks and never
// requires loading the complete File into memory.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value, shift) {
  return (value >>> shift) | (value << (32 - shift));
}

export class Sha256 {
  constructor() {
    this.state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    this.buffer = new Uint8Array(64);
    this.bufferLength = 0;
    this.bytesHashed = 0;
    this.finished = false;
    this.words = new Uint32Array(64);
  }

  update(input) {
    if (this.finished) throw new Error('SHA-256 digest is already finalized.');
    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.bytesHashed += data.length;

    let offset = 0;
    while (offset < data.length) {
      const take = Math.min(64 - this.bufferLength, data.length - offset);
      this.buffer.set(data.subarray(offset, offset + take), this.bufferLength);
      this.bufferLength += take;
      offset += take;

      if (this.bufferLength === 64) {
        this.#processBlock(this.buffer);
        this.bufferLength = 0;
      }
    }
    return this;
  }

  #processBlock(block) {
    const w = this.words;
    for (let i = 0; i < 16; i += 1) {
      const j = i * 4;
      w[i] = (
        (block[j] << 24) |
        (block[j + 1] << 16) |
        (block[j + 2] << 8) |
        block[j + 3]
      ) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = this.state;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    const s = this.state;
    s[0] = (s[0] + a) >>> 0;
    s[1] = (s[1] + b) >>> 0;
    s[2] = (s[2] + c) >>> 0;
    s[3] = (s[3] + d) >>> 0;
    s[4] = (s[4] + e) >>> 0;
    s[5] = (s[5] + f) >>> 0;
    s[6] = (s[6] + g) >>> 0;
    s[7] = (s[7] + h) >>> 0;
  }

  digest() {
    if (!this.finished) {
      const bitLength = this.bytesHashed * 8;
      this.buffer[this.bufferLength++] = 0x80;

      if (this.bufferLength > 56) {
        this.buffer.fill(0, this.bufferLength, 64);
        this.#processBlock(this.buffer);
        this.bufferLength = 0;
      }

      this.buffer.fill(0, this.bufferLength, 56);
      const high = Math.floor(bitLength / 0x100000000);
      const low = bitLength >>> 0;
      this.buffer[56] = (high >>> 24) & 0xff;
      this.buffer[57] = (high >>> 16) & 0xff;
      this.buffer[58] = (high >>> 8) & 0xff;
      this.buffer[59] = high & 0xff;
      this.buffer[60] = (low >>> 24) & 0xff;
      this.buffer[61] = (low >>> 16) & 0xff;
      this.buffer[62] = (low >>> 8) & 0xff;
      this.buffer[63] = low & 0xff;
      this.#processBlock(this.buffer);
      this.finished = true;
    }

    const output = new Uint8Array(32);
    for (let i = 0; i < 8; i += 1) {
      const value = this.state[i];
      output[i * 4] = (value >>> 24) & 0xff;
      output[i * 4 + 1] = (value >>> 16) & 0xff;
      output[i * 4 + 2] = (value >>> 8) & 0xff;
      output[i * 4 + 3] = value & 0xff;
    }
    return output;
  }

  hex() {
    return bytesToHex(this.digest());
  }
}

export function bytesToHex(bytes) {
  let value = '';
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0');
  return value;
}
