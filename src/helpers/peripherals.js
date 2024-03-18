import { Buffer } from "buffer";
import { ServerReachableListener } from "./listeners";
import aes_pkg from 'crypto-js/aes.js';
import Utf8Encoder from 'crypto-js/enc-utf8.js';
import naclPkg from 'tweetnacl';

const { encrypt, decrypt } = aes_pkg;
const { box, randomBytes } = naclPkg;

export const simplifyError = (error, message) => ({
    simpleError: { error, message }
});

export const simplifyCaughtError = (e) => e?.simpleError ? e : simplifyError('unexpected_error', `${e}`);

export const everyEntrie = (obj, callback) => {
    if (typeof obj !== 'object' || Array.isArray(obj)) return;
    oEntries(obj).forEach(e => {
        callback?.(e);
    });
}

export const flatEntries = (obj) => oEntries(obj);

export const flatRawEntries = () => oEntries(obj, false);

export const oEntries = (obj, includeObj = true) => {
    let o = [];

    Object.entries(obj).forEach(e => {
        o.push(e);
        if (e[1] && typeof e[1] === 'object' && !Array.isArray(e[1])) {
            o = [...o, ...oEntries(e[1])];
        }
    });

    return o.filter(v => includeObj || typeof v[1] !== 'object' || Array.isArray(v[1]));
}

export const IS_RAW_OBJECT = (e) => e && typeof e === 'object' && !Array.isArray(e) && !(e instanceof Date);

export const IS_WHOLE_NUMBER = (v) => typeof v === 'number' && !`${v}`.includes('.');

export const IS_DECIMAL_NUMBER = (v) => typeof v === 'number' && `${v}`.includes('.');

export const queryEntries = (obj, lastPath = '', exceptions = [], seperator = '.') => {
    let o = [];
    const isArraySeperator = Array.isArray(lastPath);

    Object.entries(obj).forEach(([key, value]) => {
        if (IS_RAW_OBJECT(value) && !exceptions.includes(key)) {
            o = [
                ...o,
                ...queryEntries(
                    value,
                    isArraySeperator ? [...lastPath, key] : `${lastPath}${key}${seperator}`,
                    exceptions,
                    seperator
                )
            ];
        } else o.push(isArraySeperator ? [[...lastPath, key], value] : [`${lastPath}${key}`, value]);
    });

    return o;
}

export const objToUniqueString = (obj) => {
    const keys = [],
        values = [];

    if (Array.isArray(obj)) {
        obj.forEach(e => {
            if (IS_RAW_OBJECT(e)) {
                queryEntries(e).map(([k, v]) => {
                    keys.push(k);
                    values.push(v);
                });
            } else keys.push(Array.isArray(e) ? JSON.stringify(e) : `${e}`);
        });
    } else if (!IS_RAW_OBJECT(obj))
        return `${obj}`;
    else
        queryEntries(obj).map(([k, v]) => {
            keys.push(k);
            values.push(v);
        });

    return [
        ...keys.sort(),
        ...values.map(v => `${Array.isArray(v) ? JSON.stringify(v) : v}`).sort()
    ].join(',');
}

export const cloneInstance = (v) => {
    if (v && typeof v === 'object') {
        return Array.isArray(v) ? [...v] : { ...v };
    }
    return v;
}

export const listenReachableServer = (callback, projectUrl) => ServerReachableListener.listenTo(projectUrl, t => {
    if (typeof t === 'boolean') callback?.(t);
}, true);

export const prefixStoragePath = (path, prefix = 'file:///') => {
    if (!path) return path;

    if (!path.startsWith('/') && !path.includes(':')) return prefix + path;

    return prefix + path.split('/').filter((v, i) => i && v).join('/');
}

export const getUrlExtension = (url) => {
    const r = url.split(/[#?]/)[0].split(".").pop().trim();
    return r === url ? '' : r;
}

export const niceTry = (promise) => new Promise(async resolve => {

    try {
        const r = await promise();
        resolve(r);
    } catch (e) { resolve(); }
});

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
    return arr.slice(0).sort(function (a, b) {
        const left = getLodash(a, key),
            right = getLodash(b, key);

        return (left > right) ? 1 : (left < right) ? -1 : 0;
    });
}

export const encryptString = (txt, password, iv) => {
    return encrypt(txt, `${password || ''}${iv || ''}`).toString();
}

export const decryptString = (txt, password, iv) => {
    return decrypt(txt, `${password || ''}${iv || ''}`).toString(Utf8Encoder);
}

export const serializeE2E = (data, auth_token, serverPublicKey) => {
    const pair = box.keyPair(),
        nonce = randomBytes(box.nonceLength),
        pubBase64 = Buffer.from(pair.publicKey).toString('base64'),
        nonceBase64 = Buffer.from(nonce).toString('base64');

    return [
        `${pubBase64}.${nonceBase64}.${Buffer.from(
            box(
                Buffer.from(JSON.stringify([
                    data,
                    auth_token
                ]), 'utf8'),
                nonce,
                Buffer.from(serverPublicKey, 'base64'),
                pair.secretKey
            )
        ).toString('base64')}`,
        [pair.secretKey, pair.publicKey]
    ];
}

export const deserializeE2E = (data, serverPublicKey, clientPrivateKey) => {
    const [binaryNonce, binaryData] = data.split('.'),
        baseArray = box.open(
            Buffer.from(binaryData, 'base64'),
            Buffer.from(binaryNonce, 'base64'),
            Buffer.from(serverPublicKey, 'base64'),
            clientPrivateKey
        );

    if (!baseArray) throw 'Decrypting e2e message failed';
    return JSON.parse(Buffer.from(baseArray).toString('utf8'))[0];
}

export const encodeBinary = (s) => Buffer.from(s, 'utf8').toString('base64');
export const decodeBinary = (s) => Buffer.from(s, 'base64').toString('utf8');