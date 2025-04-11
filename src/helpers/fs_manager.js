import { Buffer } from 'buffer';
import { deserialize, serialize } from 'entity-serializer';
import { DocumentDirectoryPath, readFile, unlink, writeFile } from 'react-native-fs';

const MAX_INLINE_BLOB = 1024;

const resolvePath = (path = '') => `file:///${DocumentDirectoryPath}${path.startsWith('/') ? path : '/' + path}`;

const fsWrite = (path, data) => writeFile(resolvePath(path), data instanceof Buffer ? data.toString('base64') : data);

const fsRead = async (path) => Buffer.from(await readFile(resolvePath(path), 'base64'), 'base64');

export const getStoreID = (db_filename, table, primary_key) => `${table}_${primary_key}_${db_filename}.blob`;

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