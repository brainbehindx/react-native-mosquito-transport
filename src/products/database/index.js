import _ from "lodash";
import { io } from "socket.io-client";
import EngineApi from "../../helpers/EngineApi";
import { DatabaseRecordsListener } from "../../helpers/listeners";
import { IS_WHOLE_NUMBER, listenReachableServer } from "../../helpers/peripherals";
import { awaitStore, buildFetchInterface, simplifyError } from "../../helpers/utils";
import { Scoped } from "../../helpers/variables";
import { accessData, addPendingWrites, commitStore, generateRecordID, getRecord, insertRecord, removePendingWrite, updateDatabaseStore } from "./accessor";
import { validateFilter, validateReadConfig, validateWriteValue } from "./validator";
import { awaitRefreshToken, listenToken } from "../auth/accessor";

export class MosquitoDbCollection {
    constructor(config) {
        this.builder = { ...config };
    }

    find = (find) => ({
        get: (config) => findObject({ ...this.builder, find }, config),
        listen: (callback, error, config) => listenDocument(callback, error, { ...this.builder, find }, config),
        count: () => countCollection({ ...this.builder, find }),
        limit: (limit) => ({
            get: (config) => findObject({ ...this.builder, find, limit }, config),
            random: (config) => findObject({ ...this.builder, find, limit, random: true }, config),
            listen: (callback, error, config) => listenDocument(callback, error, { ...this.builder, find, limit }, config),
            sort: (sort, direction) => ({
                get: (config) => findObject({ ...this.builder, find, limit, sort, direction }, config),
                listen: (callback, error, config) => listenDocument(callback, error, { ...this.builder, find, limit, sort, direction }, config)
            })
        }),
        sort: (sort, direction) => ({
            get: (config) => findObject({ ...this.builder, find, sort, direction }, config),
            listen: (callback, error, config) => listenDocument(callback, error, { ...this.builder, find, sort, direction }, config),
            limit: (limit) => ({
                get: (config) => findObject({ ...this.builder, find, sort, direction, limit }, config),
                listen: (callback, error, config) => listenDocument(callback, error, { ...this.builder, find, sort, direction, limit }, config)
            })
        })
    });

    sort = (sort, direction) => this.find().sort(sort, direction);

    limit = (limit) => this.find().limit(limit);

    count = () => countCollection({ ...this.builder });

    get = (config) => findObject({ ...this.builder }, config);

    listen = (callback, error, config) => listenDocument(callback, error, { ...this.builder }, config);

    findOne = (findOne) => ({
        listen: (callback, error, config) => listenDocument(callback, error, { ...this.builder, findOne }, config),
        get: (config) => findObject({ ...this.builder, findOne }, config)
    });

    onDisconnect = () => ({
        setOne: (value) => initOnDisconnectionTask({ ...this.builder }, value, 'setOne'),
        setMany: (value) => initOnDisconnectionTask({ ...this.builder }, value, 'setMany'),
        updateOne: (find, value) => initOnDisconnectionTask({ ...this.builder, find }, value, 'updateOne'),
        updateMany: (find, value) => initOnDisconnectionTask({ ...this.builder, find }, value, 'updateMany'),
        mergeOne: (find, value) => initOnDisconnectionTask({ ...this.builder, find }, value, 'mergeOne'),
        mergeMany: (find, value) => initOnDisconnectionTask({ ...this.builder, find }, value, 'mergeMany'),
        deleteOne: (find) => initOnDisconnectionTask({ ...this.builder, find }, null, 'deleteOne'),
        deleteMany: (find) => initOnDisconnectionTask({ ...this.builder, find }, null, 'deleteMany'),
        replaceOne: (find, value) => initOnDisconnectionTask({ ...this.builder, find }, value, 'replaceOne'),
        putOne: (find, value) => initOnDisconnectionTask({ ...this.builder, find }, value, 'putOne')
    })

    setOne = (value) => commitData(this.builder, value, 'setOne');

    setMany = (value) => commitData(this.builder, value, 'setMany');

    updateOne = (find, value) => commitData({ ...this.builder, find }, value, 'updateOne');

    updateMany = (find, value) => commitData({ ...this.builder, find }, value, 'updateMany');

    mergeOne = (find, value) => commitData({ ...this.builder, find }, value, 'mergeOne');

    mergeMany = (find, value) => commitData({ ...this.builder, find }, value, 'mergeMany');

    replaceOne = (find, value) => commitData({ ...this.builder, find }, value, 'replaceOne');

    putOne = (find, value) => commitData({ ...this.builder, find }, value, 'putOne');

    deleteOne = (find) => commitData({ ...this.builder, find }, null, 'deleteOne');

    deleteMany = (find) => commitData({ ...this.builder, find }, null, 'deleteMany');

    // writeBatchMap = (map) => commitData({ ...this.builder, find }, map, 'writeBatchMap');
}

const listenDocument = (callback, onError, builder, config) => {
    const { projectUrl, dbUrl, dbName, accessKey, path, find, findOne, sort, direction, limit, disableCache } = builder,
        accessId = generateRecordID(builder, config);

    let hasCancelled, hasRespond, cacheListener, socket, wasDisconnected, lastToken = Scoped.AuthJWTToken[projectUrl] || null, lastInitRef = 0;

    if (!disableCache) {
        cacheListener = DatabaseRecordsListener.startKeyListener(accessId, async () => {
            const cache = await getRecord(projectUrl, dbUrl, dbName, path, accessId);
            if (cache) callback?.(cache.value);
        });

        (async function () {
            try {
                await awaitStore();
                const a = await (await fetch(EngineApi._areYouOk(projectUrl))).json();
                if (a.status !== 'yes') throw 'am_sick';
            } catch (e) {
                if (hasRespond || hasCancelled) return;
                DatabaseRecordsListener.triggerKeyListener(accessId);
            }
        })();
    }

    const init = async () => {
        const processID = ++lastInitRef;
        await awaitRefreshToken(projectUrl);
        if (hasCancelled || processID !== lastInitRef) return;
        socket = io(`ws://${projectUrl.split('://')[1]}`, {
            auth: {
                mtoken: Scoped.AuthJWTToken[projectUrl],
                commands: { config, path, find: findOne || find, sort, direction, limit },
                dbName,
                dbUrl,
                accessKey
            }
        });

        socket.emit(findOne ? '_listenDocument' : '_listenCollection');
        socket.on('mSnapshot', async ([err, snapshot]) => {
            hasRespond = true;
            if (err) {
                onError?.(err?.simpleError || simplifyError('unexpected_error', `${e}`).simpleError);
            } else if (disableCache) {
                callback?.(snapshot);
            } else {
                await insertRecord(projectUrl, dbUrl, dbName, path, accessId, { sort, direction, limit, find, findOne, config }, snapshot);
                DatabaseRecordsListener.triggerKeyListener(accessId);
            }
        });

        socket.on('connect', () => {
            if (wasDisconnected) socket.emit(findOne ? '_listenDocument' : '_listenCollection');
        });

        socket.on('disconnect', () => {
            wasDisconnected = true;
        });
    };

    init();

    const tokenListener = listenToken(t => {
        if ((t || null) !== lastToken) {
            socket?.close?.();
            wasDisconnected = undefined;
            init();
        }
        lastToken = t;
    }, projectUrl);

    return () => {
        if (hasCancelled) return;
        hasCancelled = true;
        if (socket) socket.close();
        cacheListener?.();
        tokenListener?.();
    }
}

const countCollection = async (builder) => {
    const { projectUrl, dbUrl, dbName, accessKey, maxRetries = 7, path, find, disableCache } = builder,
        accessId = generateRecordID({ ...builder, countDoc: true });

    let retries = 0;

    const readValue = () => new Promise(async (resolve, reject) => {
        ++retries;
        try {
            await awaitRefreshToken(projectUrl);
            const r = await (await fetch(EngineApi._documentCount(projectUrl), buildFetchInterface({
                commands: { path, find },
                dbName,
                dbUrl,
            }, accessKey, Scoped.AuthJWTToken[projectUrl]))).json();
            if (r.simpleError) throw r;
            resolve(r.result);
            if (!disableCache) insertRecord(projectUrl, dbUrl, dbName, path, accessId, { find, isCount: true }, r.result);
        } catch (e) {
            if (e?.simpleError) {
                reject(e?.simpleError);
            } else if (!disableCache && await getRecord(projectUrl, dbUrl, dbName, path, accessId)) {
                resolve((await getRecord(projectUrl, dbUrl, dbName, path, accessId)).value);
            } else if (retries > maxRetries) {
                reject({ error: 'retry_limit_exceeded', message: `retry exceed limit(${maxRetries})` });
            } else {
                const onlineListener = listenReachableServer(connected => {
                    if (connected) {
                        onlineListener();
                        readValue().then(resolve, reject);
                    }
                }, projectUrl);
            }
        }
    });

    const g = await readValue();
    return g;
}

const initOnDisconnectionTask = (builder, value, type) => {
    let hasCancelled, socket;

    (async function () {
        const { projectUrl, dbUrl, dbName, accessKey, path, find } = builder;
        await awaitRefreshToken(projectUrl);
        if (hasCancelled) return;

        socket = io(`ws://${projectUrl.split('://')[1]}`, {
            auth: {
                mtoken: Scoped.AuthJWTToken[projectUrl],
                commands: { path, find, value, scope: type },
                dbName,
                dbUrl,
                accessKey
            }
        })

        socket.emit('_startDisconnectWriteTask');
    })()

    return () => {
        if (hasCancelled) return;
        if (socket) socket.emit('_cancelDisconnectWriteTask');
        setTimeout(() => {
            if (socket) socket.close();
        }, 700);
        hasCancelled = true;
    }
}

const findObject = async (builder, config) => {
    const { projectUrl, dbUrl, dbName, accessKey, maxRetries = 7, path, find, findOne, sort, direction, limit, disableCache, random } = builder,
        accessId = generateRecordID(builder, config);

    if (!disableCache) {
        validateReadConfig(config);
        validateFilter(find);

        if (typeof limit === 'number' && (!IS_WHOLE_NUMBER(limit) || limit <= 0))
            throw `limit() has an invalid argument, expected a positive whole number`;
    }

    let retries = 0;

    const readValue = () => new Promise(async (resolve, reject) => {
        ++retries;
        try {
            await awaitRefreshToken(projectUrl);
            const r = await (await fetch(EngineApi[findOne ? '_readDocument' : '_queryCollection'](projectUrl), buildFetchInterface({
                commands: { config, path, find: findOne || find, sort, direction, limit, random },
                dbName,
                dbUrl,
            }, accessKey, Scoped.AuthJWTToken[projectUrl]))).json();
            if (r.simpleError) throw r;
            if (!disableCache) insertRecord(projectUrl, dbUrl, dbName, path, accessId, { sort, direction, limit, find, findOne, config }, r.result);
            resolve(r.result);
        } catch (e) {
            if (e?.simpleError) {
                reject(e?.simpleError);
            } else if (!disableCache && await getRecord(projectUrl, dbUrl, dbName, path, accessId)) {
                resolve((await getRecord(projectUrl, dbUrl, dbName, path, accessId)).value);
            } else if (retries > maxRetries) {
                reject({ error: 'retry_limit_exceeded', message: `retry exceed limit(${maxRetries})` });
            } else {
                const onlineListener = listenReachableServer(connected => {
                    if (connected) {
                        onlineListener();
                        readValue().then(resolve, reject);
                    }
                }, projectUrl);
            }
        }
    });

    const g = await readValue();
    return g;
};

const commitData = async (builder, value, type) => {
    const { projectUrl, dbUrl, dbName, accessKey, maxRetries = 7, path, find, disableCache } = builder,
        writeId = `${++Scoped.PendingIte}`;

    let b4Data;

    if (!disableCache) {
        validateWriteValue(value, builder.find, type);
        if (type === 'set') {
            b4Data = (Array.isArray(value) ? value : [value]).map(v => {
                if (!v?._id) throw 'No _id found in set() operation mosquitodb';
                return accessData(projectUrl, dbUrl, dbName, path, { _id: v._id });
            });
        } else b4Data = await accessData(projectUrl, dbUrl, dbName, path, find);

        await addPendingWrites(projectUrl, dbUrl, dbName, writeId, { builder, value, type, find });
        await commitStore(projectUrl, dbUrl, dbName, path, value, find, type);
    }

    let retries = 0;

    const sendValue = () => new Promise(async (resolve, reject) => {
        ++retries;
        try {
            await awaitRefreshToken(projectUrl);
            const r = await (await fetch(EngineApi['_writeDocument'](projectUrl), buildFetchInterface({
                commands: {
                    path,
                    scope: type,
                    value,
                    find
                },
                dbName,
                dbUrl
            }, accessKey, Scoped.AuthJWTToken[projectUrl]))).json();
            if (r.simpleError) throw r;
            if (!disableCache) removePendingWrite(projectUrl, dbUrl, dbName, writeId);
            resolve({ status: 'sent', committed: r.committed });
        } catch (e) {
            if (e?.simpleError) {
                console.error(`${type} error (${path}), ${e.simpleError?.message}`);
                if (!disableCache) {
                    removePendingWrite(projectUrl, dbUrl, dbName, writeId);
                    updateDatabaseStore(projectUrl, dbUrl, dbName, path, b4Data.map(v => ({ _id: v._id, value: v })));
                }
                reject(e?.simpleError);
            } else if (retries > maxRetries) {
                console.error(`retry exceed limit(${maxRetries}): ${type} error (${path}), ${e}`);
                if (!disableCache) removePendingWrite(projectUrl, dbUrl, dbName, writeId);
            } else {
                const onlineListener = listenReachableServer(connected => {
                    if (connected) {
                        onlineListener();
                        sendValue();
                    }
                }, projectUrl);
                resolve({ status: 'pending' });
            }
        }
    });

    return await sendValue();
}