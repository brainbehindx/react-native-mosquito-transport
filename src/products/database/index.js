import _ from "lodash";
import EngineApi from "../../helpers/EngineApi";
import { listenConnection, queryEntries } from "../../helpers/peripherals";
import { buildFetchInterface } from "../../helpers/utils";
import { Scoped } from "../../helpers/variables";
import { accessData, addPendingWrites, commitStore, getRecord, insertRecord, removePendingWrite, updateDatabaseStore } from "./accessor";
import { validateFilter, validateReadConfig, validateWriteValue } from "./validator";

export class MosquitoDbCollection {
    constructor(config) {
        this.builder = { ...config };
    }

    find = (find, config) => findObject({ ...this.builder, find }, config);

    findOne = (find, config) => findObject({ ...this.builder, find }, config);

    set = (value) => commitData(this.builder, value, 'set');

    update = (find, value) => commitData({ ...this.builder, find }, value, 'update');

    updateMany = (find, value) => commitData({ ...this.builder, find }, value, 'updateMany');

    merge = (find, value) => commitData({ ...this.builder, find }, value, 'merge');

    mergeMany = (find, value) => commitData({ ...this.builder, find }, value, 'mergeMany');

    delete = (find) => commitData({ ...this.builder, find }, null, 'delete');

    deleteMany = (find) => commitData({ ...this.builder, find }, null, 'deleteMany');

    // writeBatchMap = (map) => commitData({ ...this.builder, find }, map, 'writeBatchMap');

    limit(limit) {
        this.builder.limit = limit;
    }

    count = () => null;

    listen(callback) {

    }
}

const findObject = async (builder, config) => {
    const { projectUrl, dbUrl, dbName, accessKey, maxRetries = 7, path, find } = builder,
        accessId = `read:${path}->excludes:${(config?.excludeFields || []).join(',')}->includes:${(config?.returnOnly || []).join(',')}->query:${queryEntries(find).sort().join(',')}`;

    validateReadConfig(config);
    validateFilter(find);

    let retries = 0;

    const readValue = () => new Promise(async (resolve, reject) => {
        ++retries;
        try {
            const r = await (await fetch(EngineApi._readDocument(projectUrl), buildFetchInterface({
                commands: { ...config, path, find },
                dbName,
                dbUrl,
            }, accessKey, Scoped.AuthJWTToken[projectUrl]))).json();
            if (r.simpleError) throw r;
            resolve(r.result);

            await insertRecord(projectUrl, dbUrl, dbName, accessId);
            const arrResult = Array.isArray(r.result) ? r.result : [r.result];
            updateDatabaseStore(projectUrl, dbUrl, dbName, path, arrResult.map(v => ({ _id: v._id, value: v })));
        } catch (e) {
            console.error('readValue err:', e);

            if (e?.simpleError) {
                console.error(`read error (${path}), ${e.simpleError?.message}`);
                reject(e?.simpleError);
            } else if (await getRecord(projectUrl, dbUrl, dbName, accessId)) {
                resolve(await accessData(projectUrl, dbUrl, dbName, path, find));
            } else if (retries > maxRetries) {
                console.error(`retry exceed limit(${maxRetries}): read error (${path}), ${e}`);
                reject({ error: 'retry_limit_exceeded', message: `retry exceed limit(${maxRetries})` });
            } else {
                const onlineListener = listenConnection(connected => {
                    if (connected) {
                        onlineListener();
                        readValue().then(resolve, reject);
                    }
                });
            }
        }
    });

    const g = await readValue();
    return g;
};

const commitData = async (builder, value, type) => {
    validateWriteValue(value, builder.find, type);

    const { projectUrl, dbUrl, dbName, accessKey, maxRetries = 7, path, find } = builder,
        writeId = `${++Scoped.PendingIte}`;

    let b4Data;

    if (type === 'set') {
        b4Data = (Array.isArray(value) ? value : [value]).map(v => {
            if (!v?._id) throw 'No _id found in set() operation mosquitodb';
            return accessData(projectUrl, dbUrl, dbName, path, { _id: v._id });
        });
    } else b4Data = await accessData(projectUrl, dbUrl, dbName, path, find);

    await addPendingWrites(projectUrl, dbUrl, dbName, writeId, { builder, value, type, find });
    await commitStore(projectUrl, dbUrl, dbName, path, value, find, type);

    let retries = 0;

    const sendValue = () => new Promise(async (resolve, reject) => {
        ++retries;
        try {
            const r = await (await fetch(EngineApi['_writeDocument'](projectUrl), buildFetchInterface({
                commands: {
                    path,
                    scope: type,
                    value
                },
                dbName,
                dbUrl
            }, accessKey, Scoped.AuthJWTToken[projectUrl]))).json();
            if (r.simpleError) throw r;
            removePendingWrite(projectUrl, dbUrl, dbName, writeId);
            resolve({ status: 'sent', committed: r.committed });
        } catch (e) {
            if (e?.simpleError) {
                console.error(`${type} error (${path}), ${e.simpleError?.message}`);
                removePendingWrite(projectUrl, dbUrl, dbName, writeId);
                updateDatabaseStore(projectUrl, dbUrl, dbName, path, b4Data.map(v => ({ _id: v._id, value: v })));
                reject(e?.simpleError);
            } else if (retries > maxRetries) {
                console.error(`retry exceed limit(${maxRetries}): ${type} error (${path}), ${e}`);
                removePendingWrite(projectUrl, dbUrl, dbName, writeId);
            } else {
                const onlineListener = listenConnection(connected => {
                    if (connected) {
                        onlineListener();
                        sendValue();
                    }
                });
                resolve({ status: 'pending' });
            }
        }
    });

    return await sendValue();
}