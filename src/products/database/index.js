import { io } from "socket.io-client";
import EngineApi from "../../helpers/engine_api";
import { DatabaseRecordsListener } from "../../helpers/listeners";
import { deserializeE2E, listenReachableServer, niceTry, serializeE2E } from "../../helpers/peripherals";
import { awaitStore, buildFetchInterface, getReachableServer } from "../../helpers/utils";
import { CacheStore, Scoped } from "../../helpers/variables";
import { addPendingWrites, generateRecordID, getRecord, insertRecord, listenQueryEntry, removePendingWrite, validateWriteValue } from "./accessor";
import { validateCollectionName, validateFilter, validateFindConfig, validateFindObject, validateListenFindConfig } from "./validator";
import { awaitRefreshToken, listenToken } from "../auth/accessor";
import { DELIVERY, RETRIEVAL } from "../../helpers/values";
import setLodash from 'lodash.set';
import { ObjectId } from "bson";
import { guardObject, Validator } from "guard-object";
import { simplifyCaughtError } from "simplify-error";
import cloneDeep from "lodash.clonedeep";
import { deserializeBSON, serializeToBase64 } from "./bson";

export class MTCollection {
    constructor(config) {
        this.builder = { ...config };
    }

    find = (find = {}) => ({
        get: (config) => findObject({ ...this.builder, command: { find } }, config),
        listen: (callback, error, config) => listenDocument(callback, error, { ...this.builder, command: { find } }, config),
        count: (config) => countCollection({ ...this.builder, command: { find } }, config),
        limit: (limit) => ({
            get: (config) => findObject({ ...this.builder, command: { find, limit } }, config),
            random: (config) => findObject({ ...this.builder, command: { find, limit, random: true } }, config),
            listen: (callback, error, config) => listenDocument(callback, error, { ...this.builder, command: { find, limit } }, config),
            sort: (sort, direction) => ({
                get: (config) => findObject({ ...this.builder, command: { find, limit, sort, direction } }, config),
                listen: (callback, error, config) => listenDocument(callback, error, {
                    ...this.builder,
                    command: { find, limit, sort, direction }
                }, config)
            })
        }),
        sort: (sort, direction) => ({
            get: (config) => findObject({ ...this.builder, command: { find, sort, direction } }, config),
            listen: (callback, error, config) => listenDocument(callback, error, {
                ...this.builder,
                command: { find, sort, direction }
            }, config),
            limit: (limit) => ({
                get: (config) => findObject({ ...this.builder, command: { find, sort, direction, limit } }, config),
                listen: (callback, error, config) => listenDocument(callback, error, {
                    ...this.builder,
                    command: { find, sort, direction, limit }
                }, config)
            })
        })
    });

    sort = (sort, direction) => this.find().sort(sort, direction);

    limit = (limit) => this.find().limit(limit);

    count = (config) => this.find().count(config);

    get = (config) => this.find().get(config);

    listen = (callback, error, config) => this.find().listen(callback, error, config);

    findOne = (findOne = {}) => ({
        listen: (callback, error, config) => listenDocument(callback, error, { ...this.builder, command: { findOne } }, config),
        get: (config) => findObject({ ...this.builder, command: { findOne } }, config)
    });

    onDisconnect = () => ({
        setOne: (value) => initOnDisconnectionTask({ ...this.builder }, value, 'setOne'),
        setMany: (value) => initOnDisconnectionTask({ ...this.builder }, value, 'setMany'),
        updateOne: (find = {}, value) => initOnDisconnectionTask({ ...this.builder, command: { find } }, value, 'updateOne'),
        updateMany: (find = {}, value) => initOnDisconnectionTask({ ...this.builder, command: { find } }, value, 'updateMany'),
        mergeOne: (find = {}, value) => initOnDisconnectionTask({ ...this.builder, command: { find } }, value, 'mergeOne'),
        mergeMany: (find = {}, value) => initOnDisconnectionTask({ ...this.builder, command: { find } }, value, 'mergeMany'),
        deleteOne: (find = {}) => initOnDisconnectionTask({ ...this.builder, command: { find } }, undefined, 'deleteOne'),
        deleteMany: (find = {}) => initOnDisconnectionTask({ ...this.builder, command: { find } }, undefined, 'deleteMany'),
        replaceOne: (find = {}, value) => initOnDisconnectionTask({ ...this.builder, command: { find } }, value, 'replaceOne'),
        putOne: (find = {}, value) => initOnDisconnectionTask({ ...this.builder, command: { find } }, value, 'putOne')
    });

    setOne = (value, config) => commitData(this.builder, value, 'setOne', config);

    setMany = (value, config) => commitData(this.builder, value, 'setMany', config);

    addOne = (value, config) => commitData(
        this.builder,
        Validator.OBJECT(value) ? { ...value, _id: new ObjectId() } : value,
        'setOne',
        config
    );

    addMany = (value, config) => commitData(
        this.builder,
        value.map(v => Validator.OBJECT(v) ? ({ ...v, _id: new ObjectId() }) : v),
        'setMany',
        config
    );

    updateOne = (find = {}, value, config) => commitData({ ...this.builder, find }, value, 'updateOne', config);

    updateMany = (find = {}, value, config) => commitData({ ...this.builder, find }, value, 'updateMany', config);

    mergeOne = (find = {}, value, config) => commitData({ ...this.builder, find }, value, 'mergeOne', config);

    mergeMany = (find = {}, value, config) => commitData({ ...this.builder, find }, value, 'mergeMany', config);

    replaceOne = (find = {}, value, config) => commitData({ ...this.builder, find }, value, 'replaceOne', config);

    putOne = (find = {}, value, config) => commitData({ ...this.builder, find }, value, 'putOne', config);

    deleteOne = (find = {}, config) => commitData({ ...this.builder, find }, undefined, 'deleteOne', config);

    deleteMany = (find = {}, config) => commitData({ ...this.builder, find }, undefined, 'deleteMany', config);
};

export const batchWrite = (builder, map, config) => commitData({ ...builder }, map, 'batchWrite', config);

const {
    _listenCollection,
    _listenDocument,
    _startDisconnectWriteTask,
    _cancelDisconnectWriteTask,
    _documentCount,
    _readDocument,
    _queryCollection,
    _writeDocument,
    _writeMapDocument
} = EngineApi;

const listenDocument = (callback, onError, builder, config) => {
    const { projectUrl, wsPrefix, serverE2E_PublicKey, baseUrl, dbUrl, dbName, accessKey, path, disableCache, command, uglify, castBSON } = builder;
    const { find, findOne, sort, direction, limit } = command;
    const { disableAuth } = config || {};
    const accessId = generateRecordID(builder, config);
    const shouldCache = !disableCache;
    const processId = `${++Scoped.AnyProcessIte}`;

    validateListenFindConfig(config);
    validateFilter(findOne || find);
    validateCollectionName(path);

    let hasCancelled,
        hasRespond,
        cacheListener,
        socket,
        wasDisconnected,
        lastToken = Scoped.AuthJWTToken[projectUrl] || null,
        lastInitRef = 0,
        connectedListener,
        lastSnapshot;

    const dispatchSnapshot = s => {
        const thisSnapshotId = serializeToBase64({ _: s });
        if (thisSnapshotId === lastSnapshot) return;
        lastSnapshot = thisSnapshotId;
        callback?.(cloneDeep(transformBSON(s, castBSON)));
    };

    if (shouldCache) {
        cacheListener = listenQueryEntry(snapshot => {
            if (!Scoped.IS_CONNECTED[projectUrl]) dispatchSnapshot(snapshot);
        }, { accessId, builder, config, processId });

        awaitStore().then(() => {
            if (hasCancelled) return;
            connectedListener = listenReachableServer(async connected => {
                connectedListener();
                if (!connected && !hasRespond && !hasCancelled && shouldCache)
                    DatabaseRecordsListener.dispatch('d', processId);
            }, projectUrl);
        });
    }

    const init = async () => {
        const processID = ++lastInitRef;
        if (!disableAuth) await awaitRefreshToken(projectUrl);
        if (hasCancelled || processID !== lastInitRef) return;

        const mtoken = disableAuth ? undefined : Scoped.AuthJWTToken[projectUrl];
        const pureConfig = stripRequestConfig(config);
        const authObj = {
            commands: {
                config: pureConfig && serializeToBase64(pureConfig),
                path,
                find: serializeToBase64(findOne || find),
                sort,
                direction,
                limit
            },
            dbName,
            dbUrl
        };

        const [encPlate, [privateKey]] = uglify ? serializeE2E({ accessKey, _body: authObj }, mtoken, serverE2E_PublicKey) : ['', []];

        socket = io(`${wsPrefix}://${baseUrl}`, {
            transports: ['websocket', 'polling', 'flashsocket'],
            auth: uglify ? { e2e: encPlate, _m_internal: true } : {
                accessKey,
                _body: authObj,
                ...mtoken ? { mtoken } : {},
                _m_internal: true
            }
        });

        socket.emit((findOne ? _listenDocument : _listenCollection)(uglify));
        socket.on('mSnapshot', async ([err, snapshot]) => {
            hasRespond = true;
            if (err) {
                onError?.(simplifyCaughtError(err).simpleError);
            } else {
                if (uglify) snapshot = deserializeE2E(snapshot, serverE2E_PublicKey, privateKey);
                snapshot = deserializeBSON(snapshot)._;
                dispatchSnapshot(snapshot);

                if (shouldCache) insertRecord(builder, config, accessId, snapshot);
            }
        });

        socket.on('connect', () => {
            if (wasDisconnected) socket.emit((findOne ? _listenDocument : _listenCollection)(uglify));
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
        connectedListener?.();
        cacheListener?.();
        tokenListener?.();
        if (socket) socket.close();
    }
};

const initOnDisconnectionTask = (builder, value, type) => {
    const { projectUrl, wsPrefix, baseUrl, serverE2E_PublicKey, dbUrl, dbName, accessKey, path, command, uglify } = builder;
    const { find } = command || {};
    const disableAuth = false;

    validateCollectionName(path);
    validateWriteValue({ type, find, value });

    let hasCancelled,
        socket,
        wasDisconnected,
        lastToken = Scoped.AuthJWTToken[projectUrl] || null,
        lastInitRef = 0;

    const init = async () => {
        const processID = ++lastInitRef;
        if (!disableAuth) await awaitRefreshToken(projectUrl);
        if (hasCancelled || processID !== lastInitRef) return;

        const mtoken = disableAuth ? undefined : Scoped.AuthJWTToken[projectUrl];
        const authObj = {
            commands: {
                path,
                find: find && serializeToBase64(find),
                value: value && serializeToBase64({ _: value }),
                scope: type
            },
            dbName,
            dbUrl
        };

        socket = io(`${wsPrefix}://${baseUrl}`, {
            transports: ['websocket', 'polling', 'flashsocket'],
            auth: uglify ? {
                e2e: serializeE2E(authObj, mtoken, serverE2E_PublicKey)[0],
                _m_internal: true
            } : {
                ...mtoken ? { mtoken } : {},
                accessKey,
                _body: authObj,
                _m_internal: true
            }
        });
        socket.emit(_startDisconnectWriteTask(uglify));

        socket.on('connect', () => {
            if (wasDisconnected) socket.emit(_startDisconnectWriteTask(uglify));
        });

        socket.on('disconnect', () => {
            wasDisconnected = true;
        });
    };

    init();

    const tokenListener = listenToken(async t => {
        if ((t || null) !== lastToken) {
            if (socket) {
                await niceTry(() => socket.timeout(7000).emitWithAck(_cancelDisconnectWriteTask(uglify)));
                socket.close();
            }
            wasDisconnected = undefined;
            init();
        }
        lastToken = t;
    }, projectUrl);

    return () => {
        if (hasCancelled) return;
        tokenListener();
        if (socket)
            niceTry(() => socket.timeout(7000).emitWithAck(_cancelDisconnectWriteTask(uglify))).then(() => {
                socket.close();
            });
        hasCancelled = true;
    };
};

const countCollection = async (builder, config) => {
    const { projectUrl, serverE2E_PublicKey, dbUrl, dbName, accessKey, maxRetries = 7, uglify, path, disableCache, command = {} } = builder;
    const { find } = command;
    const { disableAuth } = config || {};
    const accessId = generateRecordID({ ...builder, countDoc: true }, config);

    await awaitStore();
    if (config !== undefined)
        guardObject({
            disableAuth: t => t === undefined || Validator.BOOLEAN(t)
        }).validate(config);
    validateFilter(find);
    validateCollectionName(path);

    let retries = 0;

    const readValue = () => new Promise(async (resolve, reject) => {
        ++retries;

        const finalize = (a, b) => {
            if (Validator.NUMBER(a)) {
                reject(b);
            } else resolve(a);
        };

        try {
            if (!disableAuth && await getReachableServer(projectUrl))
                await awaitRefreshToken(projectUrl);

            const [reqBuilder, [privateKey]] = buildFetchInterface({
                body: {
                    commands: { path, find: serializeToBase64(find) },
                    dbName,
                    dbUrl
                },
                accessKey,
                ...disableAuth ? {} : { authToken: Scoped.AuthJWTToken[projectUrl] },
                serverE2E_PublicKey,
                uglify
            });

            const r = await (await fetch(_documentCount(projectUrl, uglify), reqBuilder)).json();
            if (r.simpleError) throw r;

            const f = uglify ? deserializeE2E(r.e2e, serverE2E_PublicKey, privateKey) : r;

            if (!disableCache)
                setLodash(CacheStore.DatabaseCountResult, [projectUrl, dbUrl, dbName, accessId], f.result);

            finalize(f.result);
        } catch (e) {
            const b4Data = setLodash(CacheStore.DatabaseCountResult, [projectUrl, dbUrl, dbName, accessId]);

            if (e?.simpleError) {
                finalize(undefined, e.simpleError);
            } else if (!disableCache && !Validator.NUMBER(b4Data)) {
                finalize(b4Data);
            } else if (retries > maxRetries) {
                finalize(undefined, { error: 'retry_limit_exceeded', message: `retry exceed limit(${maxRetries})` });
            } else {
                const onlineListener = listenReachableServer(connected => {
                    if (connected) {
                        onlineListener();
                        readValue().then(
                            e => { finalize(e); },
                            e => { finalize(undefined, e); }
                        );
                    }
                }, projectUrl);
            }
        }
    });

    return await readValue();
};

const stripRequestConfig = (config) => {
    const known_fields = ['extraction', 'returnOnly', 'excludeFields'];
    const requestConfig = Object.entries({ ...config }).map(([k, v]) =>
        known_fields.includes(k) ? [k, v] : null
    ).filter(v => v);
    return requestConfig.length ? Object.fromEntries(requestConfig) : undefined;
};

const transformBSON = (d, castBSON) => {
    if (castBSON) return d && deserializeBSON(serializeToBase64({ _: d }), true)._;
    return cloneDeep(d);
};

const findObject = async (builder, config) => {
    const { projectUrl, serverE2E_PublicKey, dbUrl, dbName, accessKey, maxRetries = 7, path, disableCache, uglify, command, castBSON } = builder;
    const { find, findOne, sort, direction, limit, random } = command;
    const { retrieval = RETRIEVAL.DEFAULT, episode = 0, disableAuth, disableMinimizer } = config || {};
    const enableMinimizer = !disableMinimizer;
    const accessId = generateRecordID(builder, config);
    const processAccessId = `${accessId}${projectUrl}${dbUrl}${dbName}${retrieval}`;
    const getRecordData = () => getRecord(builder, config, accessId);
    const shouldCache = (retrieval !== RETRIEVAL.DEFAULT || !disableCache) &&
        ![RETRIEVAL.NO_CACHE_NO_AWAIT, RETRIEVAL.NO_CACHE_AWAIT].includes(retrieval);

    const pureConfig = stripRequestConfig(config);
    validateFindObject(command);
    validateFindConfig(config);
    validateCollectionName(path);
    await awaitStore();

    let retries = 0, hasFinalize;

    const readValue = () => new Promise(async (resolve, reject) => {
        const retryProcess = ++retries,
            instantProcess = retryProcess === 1;

        const finalize = (a, b) => {
            const res = (instantProcess && a) ?
                (a.liveResult || a.liveResult === null) ?
                    transformBSON(a.liveResult || undefined, castBSON) :
                    transformBSON(a.episode[episode], castBSON) : a;

            if (a) {
                resolve(instantProcess ? cloneDeep(res) : a);
            } else reject(instantProcess ? cloneDeep(b) : b);
            if (hasFinalize || !instantProcess) return;
            hasFinalize = true;

            if (enableMinimizer) {
                (Scoped.PendingDbReadCollective.pendingResolution[processAccessId] || []).forEach(e => {
                    e(a ? { result: res } : undefined, b);
                });
                if (Scoped.PendingDbReadCollective.pendingResolution[processAccessId])
                    delete Scoped.PendingDbReadCollective.pendingResolution[processAccessId];

                if (Scoped.PendingDbReadCollective.pendingProcess[processAccessId])
                    delete Scoped.PendingDbReadCollective.pendingProcess[processAccessId];
            }
        };

        try {
            if (instantProcess) {
                if (enableMinimizer) {
                    if (Scoped.PendingDbReadCollective.pendingProcess[processAccessId]) {
                        if (!Scoped.PendingDbReadCollective.pendingResolution[processAccessId])
                            Scoped.PendingDbReadCollective.pendingResolution[processAccessId] = [];

                        Scoped.PendingDbReadCollective.pendingResolution[processAccessId].push((a, b) => {
                            if (a) resolve(cloneDeep(a.result));
                            else reject(cloneDeep(b));
                        });
                        return;
                    }
                    Scoped.PendingDbReadCollective.pendingProcess[processAccessId] = true;
                }

                if (retrieval.startsWith('sticky') && await getRecordData()) {
                    finalize({ episode: await getRecordData() });
                    if (retrieval !== RETRIEVAL.STICKY_RELOAD) return;
                }
            }

            if (!disableAuth && await getReachableServer(projectUrl))
                await awaitRefreshToken(projectUrl);

            const [reqBuilder, [privateKey]] = buildFetchInterface({
                body: {
                    commands: {
                        config: pureConfig && serializeToBase64(pureConfig),
                        path,
                        find: serializeToBase64(findOne || find),
                        sort,
                        direction,
                        limit,
                        random
                    },
                    dbName,
                    dbUrl
                },
                accessKey,
                authToken: disableAuth ? undefined : Scoped.AuthJWTToken[projectUrl],
                serverE2E_PublicKey,
                uglify
            });

            const r = await (await fetch((findOne ? _readDocument : _queryCollection)(projectUrl, uglify), reqBuilder)).json();
            if (r.simpleError) throw r;

            const result = deserializeBSON((uglify ? deserializeE2E(r.e2e, serverE2E_PublicKey, privateKey) : r).result)._;

            if (shouldCache) insertRecord(builder, config, accessId, result);
            finalize({ liveResult: result || null });
        } catch (e) {
            let thisRecord;
            const getThisRecord = async () => thisRecord ? thisRecord.value :
                (thisRecord = { value: await getRecordData() }).value;

            if (e?.simpleError) {
                finalize(undefined, e?.simpleError);
            } else if (
                (retrieval === RETRIEVAL.CACHE_NO_AWAIT && !(await getThisRecord())) ||
                retrieval === RETRIEVAL.STICKY_NO_AWAIT ||
                retrieval === RETRIEVAL.NO_CACHE_NO_AWAIT
            ) {
                finalize(undefined, simplifyCaughtError(e).simpleError);
            } else if (
                shouldCache &&
                [RETRIEVAL.DEFAULT, RETRIEVAL.CACHE_NO_AWAIT].includes(retrieval) &&
                await getThisRecord()
            ) {
                finalize({ episode: await getThisRecord() });
            } else if (retries > maxRetries) {
                finalize(undefined, { error: 'retry_limit_exceeded', message: `retry exceed limit(${maxRetries})` });
            } else {
                const onlineListener = listenReachableServer(connected => {
                    if (connected) {
                        onlineListener();
                        readValue().then(
                            e => { finalize(e); },
                            e => { finalize(undefined, e); }
                        );
                    }
                }, projectUrl);
            }
        }
    });

    return await readValue();
};

const transformNullRecursively = obj => Object.fromEntries(
    Object.entries(obj).map(([k, v]) =>
        [k, [undefined, Infinity, NaN].includes(v) ? null : Validator.OBJECT(v) ? transformNullRecursively(v) : v]
    )
);

const commitData = async (builder, value, type, config) => {
    // transform undefined
    if (Validator.OBJECT(value)) {
        value = value && deserializeBSON(serializeToBase64({ _: transformNullRecursively(value) }))._;
    } else if (type === 'batchWrite' && Array.isArray(value)) {
        value = deserializeBSON(
            serializeToBase64({
                _: value.map(v => {
                    if (Validator.OBJECT(v?.value)) {
                        v.value = transformNullRecursively(v.value);
                    } else if (Array.isArray(v?.value)) {
                        v.value = v.value.map(e =>
                            Validator.OBJECT(e) ? transformNullRecursively(e) : e
                        );
                    }
                    return v;
                })
            })
        )._;
    }

    const { projectUrl, serverE2E_PublicKey, dbUrl, dbName, accessKey, maxRetries = 7, path, find, disableCache, uglify } = builder;
    const { disableAuth, delivery = DELIVERY.DEFAULT, stepping } = config || {};
    const writeId = `${Date.now() + ++Scoped.PendingIte}`;
    const isBatchWrite = type === 'batchWrite';
    const shouldCache = (delivery !== DELIVERY.DEFAULT || !disableCache) &&
        delivery !== DELIVERY.NO_CACHE &&
        delivery !== DELIVERY.NO_AWAIT_NO_CACHE &&
        delivery !== DELIVERY.AWAIT_NO_CACHE;

    await awaitStore();
    if (shouldCache) {
        await addPendingWrites(builder, writeId, { value, type, find, config });
        Scoped.OutgoingWrites[writeId] = true;
        await Scoped.dispatchingWritesPromise;
    }

    let retries = 0, hasFinalize;

    const sendValue = () => new Promise(async (resolve, reject) => {
        const retryProcess = ++retries,
            instantProcess = retryProcess === 1;

        const finalize = (a, b, c) => {
            const { removeCache, revertCache } = c || {};

            if (!instantProcess) {
                if (a) a = { a, c };
                if (b) b = { b, c };
            }
            if (a) {
                resolve(a);
            } else reject(b);
            if (hasFinalize || !instantProcess) return;
            hasFinalize = true;
            if (shouldCache) {
                if (removeCache) removePendingWrite(builder, writeId, revertCache);
                if (Scoped.OutgoingWrites[writeId])
                    delete Scoped.OutgoingWrites[writeId];
            }
        };

        try {
            if (!disableAuth && await getReachableServer(projectUrl))
                await awaitRefreshToken(projectUrl);

            const [reqBuilder, [privateKey]] = buildFetchInterface({
                body: {
                    commands: {
                        value: value && serializeToBase64({ _: value }),
                        ...isBatchWrite ? { stepping } : {
                            path,
                            scope: type,
                            find: find && serializeToBase64(find)
                        }
                    },
                    dbName,
                    dbUrl
                },
                accessKey,
                serverE2E_PublicKey,
                authToken: disableAuth ? undefined : Scoped.AuthJWTToken[projectUrl],
                uglify
            });

            const r = await (await fetch((isBatchWrite ? _writeMapDocument : _writeDocument)(projectUrl, uglify), reqBuilder)).json();
            if (r.simpleError) throw r;

            const f = uglify ? deserializeE2E(r.e2e, serverE2E_PublicKey, privateKey) : r;

            finalize({ ...f }, undefined, { removeCache: true });
        } catch (e) {
            if (e?.simpleError) {
                console.error(`${type} error (${path}), ${e.simpleError?.message}`);
                finalize(undefined, e?.simpleError, { removeCache: true, revertCache: true });
            } else if (
                [
                    DELIVERY.NO_AWAIT,
                    DELIVERY.CACHE_NO_AWAIT,
                    DELIVERY.NO_AWAIT_NO_CACHE,
                    DELIVERY.NO_CACHE
                ].includes(delivery)
            ) {
                finalize(
                    undefined,
                    simplifyCaughtError(e).simpleError,
                    await getReachableServer(projectUrl) ? { removeCache: true } : undefined
                );
            } else if (retries >= maxRetries) {
                finalize(
                    undefined,
                    { error: 'retry_limit_exceeded', message: `retry exceed limit(${maxRetries})` },
                    { removeCache: true, revertCache: true }
                );
            } else {
                if (delivery === DELIVERY.AWAIT_NO_CACHE) {
                    const onlineListener = listenReachableServer(connected => {
                        if (connected) {
                            onlineListener();
                            sendValue().then(
                                e => { finalize(e.a, undefined, e.c); },
                                e => { finalize(undefined, e.b, e.c); }
                            );
                        }
                    }, projectUrl);
                } else if (shouldCache) finalize({ status: 'queued' });
                else finalize(undefined, simplifyCaughtError(e).simpleError);
            }
        }
    });

    return await sendValue();
};

export const trySendPendingWrite = (projectUrl) => {
    if (Scoped.dispatchingWritesPromise) return;

    Scoped.dispatchingWritesPromise = new Promise(async resolve => {
        const sortedWrite = Object.entries(CacheStore.PendingWrites[projectUrl] || {})
            .filter(([k]) => !Scoped.OutgoingWrites[k])
            .sort((a, b) => a[1].addedOn - b[1].addedOn);

        for (const [writeId, { snapshot, builder, attempts = 1 }] of sortedWrite) {
            try {
                await commitData(builder, snapshot.value, snapshot.type, { ...snapshot.config, delivery: DELIVERY.NO_AWAIT_NO_CACHE });
                delete CacheStore.PendingWrites[projectUrl][writeId];
            } catch (_) {
                const { maxRetries } = builder;
                if (!maxRetries || attempts >= maxRetries) {
                    delete CacheStore.PendingWrites[projectUrl][writeId];
                }
            }
        }
        resolve();
        Scoped.dispatchingWritesPromise = undefined;
        if (sortedWrite.length && await getReachableServer(projectUrl)) trySendPendingWrite(projectUrl);
    });
};