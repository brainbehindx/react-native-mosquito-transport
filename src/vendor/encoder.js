import { Buffer } from 'buffer';
import isValidUTF8 from './utf8-validator.js';

export class TextEncoder {
    encode(text) {
        return Buffer.from(text, 'utf8'); // Returns a Uint8Array-like Buffer
    }
};

export class TextDecoder {
    constructor(encoding = 'utf8', { fatal = false } = {}) {
        this.encoding = encoding;
        this.fatal = fatal;

        if (fatal && !['utf-8', 'utf8'].includes(encoding)) {
            throw new RangeError('Only UTF-8 supported for fatal decoding');
        }
    }

    decode(bytes) {
        // To simulate `fatal: true`, we need to validate the result
        if (this.fatal && !isValidUTF8(bytes)) {
            throw new TypeError('TextDecoder fatal error: invalid byte sequence');
        }
        return Buffer.from(bytes).toString(this.encoding);
    }
};

// Emulate browser's btoa (string → base64)
export function btoa(str) {
    return Buffer.from(str, 'binary').toString('base64');
};

// Emulate browser's atob (base64 → string)
export function atob(b64) {
    return Buffer.from(b64, 'base64').toString('binary');
};