import { Platform } from "react-native";
import { Buffer } from 'buffer';
import { deserialize, serialize } from 'entity-serializer';
import { Dirs, FileSystem } from 'react-native-file-access';

const MAX_INLINE_BLOB = 1024;

const DIR_PATH = `${Platform.OS === 'android' ? Dirs.DatabaseDir : Dirs.MainBundleDir}/MOSQUITO`;
const resolvePath = (path = '') => `${DIR_PATH}/${path.startsWith('/') ? path : '/' + path}`;

const DIR_CREATION_PROMISE = FileSystem.mkdir(DIR_PATH).catch(() => null);

const fsWrite = async (path, data) => {
    await DIR_CREATION_PROMISE;
    return FileSystem.writeFile(resolvePath(path), data instanceof Buffer ? data.toString('base64') : data, 'base64');
}

const fsRead = async (path) => {
    await DIR_CREATION_PROMISE;
    return Buffer.from(await FileSystem.readFile(resolvePath(path), 'base64'), 'base64');
}

export const getStoreID = (db_filename, table, primary_key) => `${table}_${primary_key}_${db_filename}.blob`;

export const deleteBigData = (store_id) => FileSystem.unlink(resolvePath(store_id));

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