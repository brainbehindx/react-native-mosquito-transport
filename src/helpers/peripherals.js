import { Buffer } from "buffer";
import { ServerReachableListener } from "./listeners";
import naclPkg from 'tweetnacl';
import getLodash from "lodash/get";
import { deserialize, serialize } from "entity-serializer";
import { sha256 } from 'react-native-sha256';
import { purifyFilepath } from "./fs_manager";

const { box, randomBytes } = naclPkg;

export const listenReachableServer = (callback, projectUrl) => {
    let lastValue;
    return ServerReachableListener.listenTo(projectUrl, t => {
        if (typeof t === 'boolean' && t !== lastValue) callback?.(t);
        lastValue = t;
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
    const array = n.slice(0);
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

export async function niceHash(str = '') {
    const hash = Buffer.from(await sha256(str), 'hex').toString('base64');
    return purifyFilepath(hash);
};

export const sameInstance = (var1, var2) => {
    try {
        return var1.constructor === var2.constructor &&
            Object.getPrototypeOf(var1) === Object.getPrototypeOf(var2)
    } catch (_) {
        return false;
    }
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
                    serverPublicKey,
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
            binaryData,
            binaryNonce,
            serverPublicKey,
            clientPrivateKey
        );

    if (!baseArray) throw 'Decrypting e2e message failed';
    return deserialize(baseArray);
};

export const encodeBinary = (s) => Buffer.from(s, 'utf8').toString('base64');
export const decodeBinary = (s) => Buffer.from(s, 'base64').toString('utf8');