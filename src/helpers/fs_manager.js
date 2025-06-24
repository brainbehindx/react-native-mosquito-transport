import { Platform } from "react-native";
import { Buffer } from 'buffer';
import { deserialize, serialize } from 'entity-serializer';
import { writeFile, mkdir, MainBundlePath, readFile, unlink, DocumentDirectoryPath } from "react-native-fs";

const MAX_INLINE_BLOB = 1024;

const DIR_PATH = `${Platform.OS === 'android' ? DocumentDirectoryPath.split('/').slice(0, -1).join('/').concat('/databases') : MainBundlePath}/MOSQUITO`;
const resolvePath = (path = '') => `${DIR_PATH}${path.startsWith('/') ? path : '/' + path}`;

const DIR_CREATION_PROMISE = mkdir(DIR_PATH).catch(() => null);

const fsWrite = async (path, data) => {
    await DIR_CREATION_PROMISE;
    return writeFile(resolvePath(path), data instanceof Buffer ? data.toString('base64') : data, 'base64');
}

const fsRead = async (path) => {
    await DIR_CREATION_PROMISE;
    return Buffer.from(await readFile(resolvePath(path), 'base64'), 'base64');
}

const purifyFilename = (filename) => {
    if (!filename || typeof filename !== 'string') return 'unnamed';

    // Remove invalid characters for both iOS and Android
    return filename
        .replace(/[/\\?%*:|"<>]/g, '') // Remove forbidden characters
        .trim(); // Remove leading/trailing whitespace
}

export const getStoreID = (db_filename, table, primary_key) => purifyFilename(`${table}_${primary_key}_${db_filename}.blob`);

export const deleteBigData = (store_id) => unlink(resolvePath(store_id));

export const handleBigData = async (store_id, data) => {
    const bufData = serialize(data);
    if (bufData.byteLength <= MAX_INLINE_BLOB) {
        return serialize([bufData]).toString('base64');
    }
    await fsWrite(store_id, bufData);
    return serialize([undefined, store_id]).toString('base64');
};

export const parseBigData = async (result) => {
    const [inline, store_id] = deserialize(Buffer.from(result, 'base64'));
    if (store_id) {
        try {
            return deserialize(await fsRead(store_id));
        } catch (error) {
            throw `Referenced local file is either corrupted or deleted, Error: ${error}`;
        }
    }
    return deserialize(inline);
};