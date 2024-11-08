import { Buffer } from "buffer";
import { ServerReachableListener } from "./listeners";
import aes_pkg from 'crypto-js/aes.js';
import Utf8Encoder from 'crypto-js/enc-utf8.js';
import naclPkg from 'tweetnacl';
import getLodash from "lodash.get";
import { deserialize, serialize } from "entity-serializer";

const { encrypt, decrypt } = aes_pkg;
const { box, randomBytes } = naclPkg;

export const listenReachableServer = (callback, projectUrl) => {
    let lastValue;
    return ServerReachableListener.listenTo(projectUrl, t => {
        if (typeof t === 'boolean' && t !== lastValue) callback?.(t);
    }, true);
};

export const prefixStoragePath = (path, prefix = 'file:///') => {
    let cleanedPath = path.replace(/^[^/]+:\/{1,3}/, '');

    // Continuously remove any remaining protocol patterns until none are left
    while (/^[^/]+:\/{1,3}/.test(cleanedPath)) {
        cleanedPath = cleanedPath.replace(/^[^/]+:\/{1,3}/, '');
    }

    // Remove any leading slashes after protocol removal
    cleanedPath = cleanedPath.replace(/^\/+/, '');

    return `${prefix}${cleanedPath}`;
};

export const niceTry = (promise) => new Promise(async resolve => {
    try {
        const r = await promise();
        resolve(r);
    } catch (e) { resolve(); }
});

export const normalizeRoute = (route = '') => route.split('').map((v, i, a) =>
    ((!i && v === '/') || (i === a.length - 1 && v === '/') || (i && a[i - 1] === '/' && v === '/')) ? '' : v
).join('');

export const shuffleArray = (n) => {
    const array = [...n];
    let currentIndex = array.length, randomIndex;

    while (currentIndex != 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex], array[currentIndex]
        ];
    }

    return array;
}

export function sortArrayByObjectKey(arr = [], key) {
    return arr.sort(function (a, b) {
        const left = getLodash(a, key),
            right = getLodash(b, key);

        return (left > right) ? 1 : (left < right) ? -1 : 0;
    });
};

export async function niceHash(str) {
    try {
        // Convert the string to a Uint8Array
        const encoder = new TextEncoder();
        const data = encoder.encode(str);

        // Use the Web Crypto API to compute the hash
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);

        // Convert the ArrayBuffer to a hex string for readability
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');

        // Convert to base64
        return Buffer.from(hashHex, 'hex').toString('base64');
    } catch (_) {
        return str;
    }
};

export const sameInstance = (var1, var2) => {
    try {
        return var1.constructor === var2.constructor &&
            Object.getPrototypeOf(var1) === Object.getPrototypeOf(var2)
    } catch (_) {
        return false;
    }
};

export const encryptString = (txt, password, iv) => {
    return encrypt(txt, `${password || ''}${iv || ''}`).toString();
};

export const decryptString = (txt, password, iv) => {
    return decrypt(txt, `${password || ''}${iv || ''}`).toString(Utf8Encoder);
};

export const serializeE2E = async (data, auth_token, serverPublicKey) => {
    const pair = box.keyPair(),
        nonce = randomBytes(box.nonceLength);

    return [
        serialize([
            pair.publicKey,
            nonce,
            Buffer.from(
                box(
                    serialize([
                        data,
                        auth_token
                    ]),
                    nonce,
                    Buffer.from(serverPublicKey, 'base64'),
                    pair.secretKey
                )
            )
        ]),
        [pair.secretKey, pair.publicKey]
    ];
};

export const deserializeE2E = async (data, serverPublicKey, clientPrivateKey) => {
    const [binaryNonce, binaryData] = deserialize(data),
        baseArray = box.open(
            Buffer.from(binaryData, 'base64'),
            Buffer.from(binaryNonce, 'base64'),
            Buffer.from(serverPublicKey, 'base64'),
            clientPrivateKey
        );

    if (!baseArray) throw 'Decrypting e2e message failed';
    return deserialize(baseArray);
};

export const encodeBinary = (s) => Buffer.from(s, 'utf8').toString('base64');
export const decodeBinary = (s) => Buffer.from(s, 'base64').toString('utf8');