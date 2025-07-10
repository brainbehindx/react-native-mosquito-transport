import isValidUTF8 from './utf8-validator.js';

const valid1 = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]);
// Decodes to: "Hello"

const valid2 = new Uint8Array([0xE2, 0x82, 0xAC]);
// Decodes to: "€"

const valid3 = new Uint8Array([0xF0, 0x9D, 0x84, 0x9E]);
// Decodes to: "𝄞"

 
const invalid1 = new Uint8Array([0xC0, 0xAF]);
// ❌ Overlong form of ASCII slash – invalid

const invalid2 = new Uint8Array([0xE2, 0x82]);
// ❌ Missing 3rd continuation byte – invalid

const invalid3 = new Uint8Array([0xE2, 0x28, 0xA1]);
// ❌ Second byte `0x28` is not a valid continuation byte – invalid

const invalid4 = new Uint8Array([0x80]);
// ❌ Continuation byte with no leading byte – invalid

const invalid5 = new Uint8Array([0xED, 0xA0, 0x80]);
// ❌ U+D800 is a high surrogate – invalid in UTF-8


[valid1, valid2, valid3].forEach((e, i) => {
    console.log(`valid${i + 1}: utf8:`, Buffer.from(e).toString('utf8'), ' isValidUTF8:', isValidUTF8(e));
});

[invalid1, invalid2, invalid3, invalid4, invalid5].forEach((e, i) => {
    console.log(`invalid${i + 1}: utf8:`, Buffer.from(e).toString('utf8'), ' isValidUTF8:', isValidUTF8(e));
});