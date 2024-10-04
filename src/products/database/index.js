import { io } from "socket.io-client";
import EngineApi from "../../helpers/EngineApi";
import { DatabaseRecordsListener } from "../../helpers/listeners";
import { IS_WHOLE_NUMBER, cloneInstance, deserializeE2E, listenReachableServer, niceTry, serializeE2E, simplifyCaughtError } from "../../helpers/peripherals";
import { awaitStore, buildFetchInterface, getReachableServer } from "../../helpers/utils";
import { CacheStore, Scoped } from "../../helpers/variables";
import { addPendingWrites, generateRecordID, getRecord, insertRecord, listenQueryEntry, removePendingWrite } from "./accessor";
import { validateCollectionPath, validateFilter, validateReadConfig, validateWriteValue } from "./validator";
import { awaitRefreshToken, listenToken } from "../auth/accessor";
import { DEFAULT_DB_NAME, DEFAULT_DB_URL, DELIVERY, RETRIEVAL } from "../../helpers/values";
import setLodash from 'lodash.set';

export class MTCollection {
    constructor(config) {
        this.builder = { ...config };
    }

    find = (find) => ({
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

    count = (config) => countCollection({ ...this.builder }, config);

    get = (config) => findObject({ ...this.builder }, config);

    listen = (callback, error, config) => listenDocument(callback, error, { ...this.builder }, config);

    findOne = (findOne = {}) => ({
        listen: (callback, error, config) => listenDocument(callback, error, { ...this.builder, command: { findOne } }, config),
        get: (config) => findObject({ ...this.builder, command: { findOne } }, config)
    });

    onDisconnect = () => ({
        setOne: (value) => initOnDisconnectionTask({ ...this.builder }, value, 'setOne'),
        setMany: (value) => initOnDisconnectionTask({ ...this.builder }, value, 'setMany'),
        updateOne: (find, value) => initOnDisconnectionTask({ ...this.builder, command: { find } }, value, 'updateOne'),
        updateMany: (find, value) => initOnDisconnectionTask({ ...this.builder, command: { find } }, value, 'updateMany'),
        mergeOne: (find, value) => initOnDisconnectionTask({ ...this.builder, command: { find } }, value, 'mergeOne'),
        mergeMany: (find, value) => initOnDisconnectionTask({ ...this.builder, command: { find } }, value, 'mergeMany'),
        deleteOne: (find) => initOnDisconnectionTask({ ...this.builder, command: { find } }, undefined, 'deleteOne'),
        deleteMany: (find) => initOnDisconnectionTask({ ...this.builder, command: { find } }, undefined, 'deleteMany'),
        replaceOne: (find, value) => initOnDisconnectionTask({ ...this.builder, command: { find } }, value, 'replaceOne'),
        putOne: (find, value) => initOnDisconnectionTask({ ...this.builder, command: { find } }, value, 'putOne')
    })

    setOne = (value, config) => commitData(this.builder, value, 'setOne', config);

    setMany = (value, config) => commitData(this.builder, value, 'setMany', config);

    updateOne = (find, value, config) => commitData({ ...this.builder, find }, value, 'updateOne', config);

    updateMany = (find, value, config) => commitData({ ...this.builder, find }, value, 'updateMany', config);

    mergeOne = (find, value, config) => commitData({ ...this.builder, find }, value, 'mergeOne', config);

    mergeMany = (find, value, config) => commitData({ ...this.builder, find }, value, 'mergeMany', config);

    replaceOne = (find, value, config) => commitData({ ...this.builder, find }, value, 'replaceOne', config);

    putOne = (find, value, config) => commitData({ ...this.builder, find }, value, 'putOne', config);

    deleteOne = (find, config) => commitData({ ...this.builder, find }, undefined, 'deleteOne', config);

    deleteMany = (find, config) => commitData({ ...this.builder, find }, undefined, 'deleteMany', config);
}

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
    const { projectUrl, wsPrefix, serverE2E_PublicKey, baseUrl, dbUrl, dbName, accessKey, path, disableCache, command, uglify } = builder,
        { find, findOne, sort, direction, limit } = command,
        { disableAuth } = config || {},
        accessId = generateRecordID(builder, config),
        shouldCache = !disableCache,
        processId = `${++Scoped.AnyProcessIte}`;

    validateReadConfig(config, ['retrieval', 'disableAuth']);
    validateFilter(findOne || find);
    validateCollectionPath(path);

    let hasCancelled,
        hasRespond,
        cacheListener,
        socket,
        wasDisconnected,
        lastToken = Scoped.AuthJWTToken[projectUrl] || null,
        lastInitRef = 0,
        connectedListener;

    if (shouldCache) {
        cacheListener = listenQueryEntry(callback, { accessId, builder, config, processId });

        connectedListener = listenReachableServer(async connected => {
            connectedListener();
            await awaitStore();
            if (!connected && !hasRespond && !hasCancelled && shouldCache)
                DatabaseRecordsListener.dispatch(accessId, processId);
        }, projectUrl);
    }

    const init = async () => {
        const processID = ++lastInitRef;
        if (!disableAuth) await awaitRefreshToken(projectUrl);
        if (hasCancelled || processID !== lastInitRef) return;

        const mtoken = disableAuth ? undefined : Scoped.AuthJWTToken[projectUrl],
            authObj = {
                commands: {
                    config: stripRequestConfig(config),
                    path,
                    find: findOne || find,
                    sort,
                    direction,
                    limit
                },
                dbName,
                dbUrl
            };

        const [encPlate, [privateKey]] = uglify ? serializeE2E({ accessKey, _body: authObj }, mtoken, serverE2E_PublicKey) : ['', []];

        socket = io(`${wsPrefix}://${baseUrl}`, {
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
                callback?.(snapshot);

                if (shouldCache)
                    insertRecord(builder, accessId, { sort, direction, limit, find, findOne, config }, snapshot);
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
}

const initOnDisconnectionTask = (builder, value, type) => {
    const { projectUrl, wsPrefix, baseUrl, serverE2E_PublicKey, dbUrl, dbName, accessKey, path, command, uglify } = builder,
        { find } = command || {},
        disableAuth = false;

    validateCollectionPath(path);
    let hasCancelled,
        socket,
        wasDisconnected,
        lastToken = Scoped.AuthJWTToken[projectUrl] || null,
        lastInitRef = 0;

    const init = async () => {
        const processID = ++lastInitRef;
        if (!disableAuth) await awaitRefreshToken(projectUrl);
        if (hasCancelled || processID !== lastInitRef) return;

        const mtoken = disableAuth ? undefined : Scoped.AuthJWTToken[projectUrl],
            authObj = {
                commands: { path, find, value, scope: type },
                dbName,
                dbUrl
            };

        socket = io(`${wsPrefix}://${baseUrl}`, {
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
                await niceTry(() => socket.timeout(10000).emitWithAck(_cancelDisconnectWriteTask(uglify)));
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
            (async () => {
                await niceTry(() => socket.timeout(10000).emitWithAck(_cancelDisconnectWriteTask(uglify)));
                socket.close();
            })();
        hasCancelled = true;
    }
}

const countCollection = async (builder, config) => {
    const { projectUrl, serverE2E_PublicKey, dbUrl, dbName, accessKey, maxRetries = 7, uglify, path, disableCache, command = {} } = builder,
        { find } = command,
        { disableAuth } = config || {},
        accessId = generateRecordID({ ...builder, countDoc: true }, config);

    await awaitStore();
    validateReadConfig(config, [
        'excludeFields',
        'returnOnly',
        'extraction',
        'episode',
        'retrieval',
        'disableMinimizer'
    ]);
    validateFilter(find || {});
    validateCollectionPath(path);

    let retries = 0;

    const readValue = () => new Promise(async (resolve, reject) => {
        ++retries;

        const finalize = (a, b) => {
            if (isNaN(a)) {
                reject(b);
            } else resolve(a);
        }

        try {
            if (!disableAuth && await getReachableServer(projectUrl)) await awaitRefreshToken(projectUrl);

            const [reqBuilder, [privateKey]] = buildFetchInterface({
                body: {
                    commands: { path, find },
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
                setLodash(CacheStore.DatabaseCountResult, [projectUrl, dbUrl || DEFAULT_DB_URL, dbName || DEFAULT_DB_NAME, accessId], f.result);

            finalize(f.result);
        } catch (e) {
            const b4Data = setLodash(CacheStore.DatabaseCountResult, [projectUrl, dbUrl || DEFAULT_DB_URL, dbName || DEFAULT_DB_NAME, accessId]);

            if (e?.simpleError) {
                finalize(undefined, e.simpleError);
            } else if (!disableCache && !isNaN(b4Data)) {
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

    const g = await readValue();
    return g;
}

const stripRequestConfig = (config) => {
    const known_fields = ['extraction', 'returnOnly', 'excludeFields'];
    const requestConfig = Object.entries({ ...config }).map(([k, v]) =>
        known_fields.includes(k) ? [k, v] : null
    ).filter(v => v);
    return requestConfig.length ? Object.fromEntries(requestConfig) : undefined;
}

const findObject = async (builder, config) => {
    const { projectUrl, serverE2E_PublicKey, dbUrl, dbName, accessKey, maxRetries = 7, path, disableCache, uglify, command } = builder,
        { find, findOne, sort, direction, limit, random } = command,
        { retrieval = RETRIEVAL.DEFAULT, episode = 0, disableAuth, disableMinimizer } = config || {},
        enableMinimizer = !disableMinimizer,
        accessId = generateRecordID(builder, config),
        processAccessId = `${accessId}${projectUrl}${dbUrl}${dbName}${retrieval}`,
        getRecordData = () => getRecord(builder, accessId),
        shouldCache = (retrieval === RETRIEVAL.DEFAULT ? !disableCache : true) &&
            retrieval !== RETRIEVAL.NO_CACHE_NO_AWAIT;

    await awaitStore();
    if (shouldCache) {
        validateReadConfig(config);
        validateCollectionPath(path);
        validateFilter(findOne || find);

        if (typeof limit === 'number' && (!IS_WHOLE_NUMBER(limit) || limit <= 0))
            throw `limit() has an invalid argument for "${path}", expected a positive whole number but got ${limit}`;
    }

    let retries = 0, hasFinalize;

    const readValue = () => new Promise(async (resolve, reject) => {
        const retryProcess = ++retries,
            instantProcess = retryProcess === 1;

        const finalize = (a, b) => {
            const res = (instantProcess && a) ?
                (a.liveResult || a.liveResult === null) ?
                    (a.liveResult || undefined) :
                    a.episode[episode] : a;

            if (a) {
                resolve(instantProcess ? res : a);
            } else reject(b);
            if (hasFinalize || !instantProcess) return;
            hasFinalize = true;

            if (enableMinimizer) {
                (Scoped.PendingDbReadCollective.pendingResolution[processAccessId] || []).forEach(e => {
                    e(a ? { result: cloneInstance(res) } : undefined, b);
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
                            if (a) resolve(a.result);
                            else reject(b);
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
                        config: stripRequestConfig(config),
                        path,
                        find: findOne || find,
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

            const f = uglify ? deserializeE2E(r.e2e, serverE2E_PublicKey, privateKey) : r;

            if (shouldCache) insertRecord(builder, accessId, { ...command, config }, f.result);
            finalize({ liveResult: f.result || null });
        } catch (e) {
            if (e?.simpleError) {
                finalize(undefined, e?.simpleError);
            } else if (
                (retrieval === RETRIEVAL.CACHE_NO_AWAIT && !(await getRecordData())) ||
                retrieval === RETRIEVAL.STICKY_NO_AWAIT ||
                retrieval === RETRIEVAL.NO_CACHE_NO_AWAIT
            ) {
                finalize(undefined, simplifyCaughtError(e).simpleError);
            } else if (
                shouldCache &&
                (retrieval === RETRIEVAL.DEFAULT || retrieval === RETRIEVAL.CACHE_NO_AWAIT) &&
                await getRecordData()
            ) {
                finalize({ episode: await getRecordData() });
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

    const g = await readValue();
    return g;
};

const commitData = async (builder, value, type, config) => {
    const { projectUrl, serverE2E_PublicKey, dbUrl, dbName, accessKey, maxRetries = 7, path, find, disableCache, uglify } = builder,
        { disableAuth, delivery = DELIVERY.DEFAULT, stepping } = config || {},
        writeId = `${Date.now() + ++Scoped.PendingIte}`,
        isBatchWrite = type === 'batchWrite',
        shouldCache = (delivery === DELIVERY.DEFAULT ? !disableCache : true) &&
            delivery !== DELIVERY.NO_CACHE &&
            delivery !== DELIVERY.NO_AWAIT_NO_CACHE &&
            delivery !== DELIVERY.AWAIT_NO_CACHE;

    await awaitStore();
    if (shouldCache) {
        validateCollectionPath(path);
        // TODO: batchWrite
        validateWriteValue(value, builder.find, type);
        await addPendingWrites(builder, writeId, { value, type, find });
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
            if (removeCache && shouldCache) removePendingWrite(builder, writeId, revertCache);
        };

        try {
            if (!disableAuth && await getReachableServer(projectUrl))
                await awaitRefreshToken(projectUrl);

            const [reqBuilder, [privateKey]] = buildFetchInterface({
                body: {
                    commands: {
                        value,
                        ...isBatchWrite ? { stepping } : {
                            path,
                            scope: type,
                            find
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

            finalize({ status: 'sent', committed: f.committed }, undefined, { removeCache: true });
        } catch (e) {
            if (e?.simpleError) {
                console.error(`${type} error (${path}), ${e.simpleError?.message}`);
                finalize(undefined, e?.simpleError, { removeCache: true, revertCache: true });
            } else if (
                delivery === DELIVERY.NO_AWAIT ||
                delivery === DELIVERY.CACHE_NO_AWAIT ||
                delivery === DELIVERY.NO_AWAIT_NO_CACHE ||
                delivery === DELIVERY.NO_CACHE
            ) {
                finalize(
                    undefined,
                    simplifyCaughtError(e).simpleError,
                    await getReachableServer(projectUrl) ? { removeCache: true } : null
                );
            } else if (retries > maxRetries) {
                finalize(undefined, { error: 'retry_limit_exceeded', message: `retry exceed limit(${maxRetries})` });
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
                } else if (shouldCache) finalize({ status: 'pending' });
                else finalize(undefined, simplifyCaughtError(e).simpleError);
            }
        }
    });

    return await sendValue();
}