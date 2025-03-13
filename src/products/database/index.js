import { io } from "socket.io-client";
import EngineApi from "../../helpers/engine_api";
import { DatabaseRecordsListener } from "../../helpers/listeners";
import { deserializeE2E, listenReachableServer, niceTry, serializeE2E } from "../../helpers/peripherals";
import { awaitStore, buildFetchInterface, buildFetchResult, getReachableServer } from "../../helpers/utils";
import { CacheStore, Scoped } from "../../helpers/variables";
import { addPendingWrites, generateRecordID, getCountQuery, getRecord, insertCountQuery, insertRecord, listenQueryEntry, removePendingWrite, validateWriteValue } from "./accessor";
import { validateCollectionName, validateFilter, validateFindConfig, validateFindObject, validateListenFindConfig } from "./validator";
import { awaitRefreshToken, listenToken } from "../auth/accessor";
import { DELIVERY, RETRIEVAL } from "../../helpers/values";
import { ObjectId } from "bson";
import { guardObject, Validator } from "guard-object";
import { simplifyCaughtError } from "simplify-error";
import cloneDeep from "lodash/cloneDeep";
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

export const onCollectionConnect = (builder) => ({
    ...collectionIO(data => ({
        ...initCollectionIO({ connectData: data, builder }),
        onDisconnect: () => collectionIO(data2 =>
            initCollectionIO({ connectData: data, disconnectData: data2, builder })
        )
    })),
    onDisconnect: () => collectionIO(data =>
        initCollectionIO({ disconnectData: data, builder })
    )
});

const collectionIO = (caller) => ({
    batchWrite: (map, config) => caller({ value: map, config })
});

const initCollectionIO = (data) => ({
    start: () => initOnDisconnectionTask(data)
});

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
    const { projectUrl, wsPrefix, serverE2E_PublicKey, baseUrl, dbUrl, dbName, path, disableCache, command, uglify, extraHeaders, castBSON } = builder;
    const { find, findOne, sort, direction, limit } = command;
    const { disableAuth, episode } = config || {};
    const shouldCache = !disableCache;
    const processId = `${++Scoped.AnyProcessIte}`;
    let accessId;

    validateListenFindConfig(config);
    validateFilter(findOne || find);
    validateCollectionName(path);

    let hasCancelled,
        hasRespond,
        cacheListener,
        socket,
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
        accessId = generateRecordID(builder, config, true).then(hash => {
            if (hasCancelled) return hash;
            cacheListener = listenQueryEntry(snapshot => {
                if (!Scoped.IS_CONNECTED[projectUrl]) dispatchSnapshot(snapshot);
            }, { accessId: hash, builder, config, processId });
            return hash;
        });

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
            commands: stripUndefined({
                config: pureConfig && serializeToBase64(pureConfig),
                path,
                find: serializeToBase64(findOne || find),
                sort,
                direction,
                limit
            }),
            ...dbName ? { dbName } : undefined,
            ...dbUrl ? { dbUrl } : undefined
        };

        const [encPlate, [privateKey]] = uglify ? await serializeE2E({ _body: authObj }, mtoken, serverE2E_PublicKey) : ['', []];

        socket = io(`${wsPrefix}://${baseUrl}`, {
            transports: ['websocket', 'polling', 'flashsocket'],
            extraHeaders,
            auth: {
                ...uglify ? { e2e: encPlate.toString('base64') } : {
                    _body: authObj,
                    ...mtoken ? { mtoken } : {}
                },
                _m_internal: true,
                _m_route: (findOne ? _listenDocument : _listenCollection)(uglify)
            }
        });

        socket.on('mSnapshot', async ([err, snapshot]) => {
            hasRespond = true;
            if (err) {
                if (typeof onError === 'function') {
                    onError(simplifyCaughtError(err).simpleError);
                } else console.error('unhandled listen for:', { path, find }, ' error:', err);
            } else {
                if (uglify) snapshot = await deserializeE2E(snapshot, serverE2E_PublicKey, privateKey);
                snapshot = hydrateForeignDoc(deserializeBSON(snapshot)._);
                dispatchSnapshot(snapshot);

                if (shouldCache) insertRecord(builder, config, await accessId, snapshot, episode);
            }
        });
    };

    init();

    const tokenListener = listenToken(t => {
        if ((t || null) !== lastToken) {
            socket?.close?.();
            socket = undefined;
            init();
        }
        lastToken = t || null;
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

const initOnDisconnectionTask = ({ builder, connectData, disconnectData }) => {
    const { projectUrl, wsPrefix, baseUrl, serverE2E_PublicKey, dbUrl, dbName, extraHeaders, uglify } = builder;
    const disableAuth = false;

    [connectData, disconnectData].forEach((e) => {
        if (e) {
            if (e.config !== undefined)
                guardObject({
                    stepping: t => t === undefined || Validator.BOOLEAN(t)
                }).validate(e.config);

            cleanBatchWrite(e.value).forEach(e => {
                const { scope, find, value, path } = e;
                validateCollectionName(path);
                validateWriteValue({ find, value, type: scope });
            });
        }
    });

    let hasCancelled,
        /**
         * @type {import('socket.io-client').Socket}
         */
        socket,
        lastToken = Scoped.AuthJWTToken[projectUrl] || null,
        lastInitRef = 0;

    const init = async () => {
        const processID = ++lastInitRef;
        if (!disableAuth) await awaitRefreshToken(projectUrl);
        if (hasCancelled || processID !== lastInitRef) return;

        const mtoken = disableAuth ? undefined : Scoped.AuthJWTToken[projectUrl];
        const makeObj = (d) => ({
            ...d?.config,
            value: serializeToBase64({ _: cleanBatchWrite(d.value) })
        });

        const authObj = {
            commands: {
                ...connectData ? { connectTask: makeObj(connectData) } : {},
                ...disconnectData ? { disconnectTask: makeObj(disconnectData) } : {}
            },
            ...dbName ? { dbName } : undefined,
            ...dbUrl ? { dbUrl } : undefined
        };

        socket = io(`${wsPrefix}://${baseUrl}`, {
            transports: ['websocket', 'polling', 'flashsocket'],
            extraHeaders,
            auth: {
                ...uglify ? {
                    e2e: (await serializeE2E({ _body: authObj }, mtoken, serverE2E_PublicKey))[0].toString('base64')
                } : {
                    ...mtoken ? { mtoken } : {},
                    _body: authObj
                },
                _m_internal: true,
                _m_route: _startDisconnectWriteTask(uglify)
            }
        });
    };

    init();

    const tokenListener = disableAuth ? undefined : listenToken(async t => {
        if ((t || null) !== lastToken) {
            if (socket) {
                socket.close();
                socket = undefined;
                setTimeout(init, 500);
            } else init();
        }
        lastToken = t;
    }, projectUrl);

    return () => {
        if (hasCancelled) return;
        hasCancelled = true;
        tokenListener?.();
        if (socket) {
            const thisSocket = socket;
            return niceTry(() => thisSocket.timeout(5000).emitWithAck(_cancelDisconnectWriteTask(uglify))).finally(() => {
                thisSocket.close();
            });
        }
    };
};

const countCollection = async (builder, config) => {
    const { projectUrl, serverE2E_PublicKey, dbUrl, dbName, maxRetries = 1, uglify, extraHeaders, path, disableCache, command = {} } = builder;
    const { find } = command;
    const { disableAuth } = config || {};
    const accessId = await generateRecordID({ ...builder, countDoc: true }, config);

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
                resolve(a);
            } else reject(b);
        };

        try {
            if (!disableAuth && await getReachableServer(projectUrl))
                await awaitRefreshToken(projectUrl);

            const [reqBuilder, [privateKey]] = await buildFetchInterface({
                body: {
                    commands: { path, find: serializeToBase64(find) },
                    ...dbName ? { dbName } : undefined,
                    ...dbUrl ? { dbUrl } : undefined
                },
                ...disableAuth ? {} : { authToken: Scoped.AuthJWTToken[projectUrl] },
                serverE2E_PublicKey,
                uglify,
                extraHeaders
            });

            const data = await buildFetchResult(await fetch(_documentCount(projectUrl, uglify), reqBuilder), uglify);

            const f = uglify ? await deserializeE2E(data, serverE2E_PublicKey, privateKey) : data;

            finalize(f.result);

            if (!disableCache) insertCountQuery(builder, accessId, f.result);
        } catch (e) {
            const b4Data = await getCountQuery(builder, accessId).catch(() => null);

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

const stripUndefined = o => Object.fromEntries(
    Object.entries(o).filter(v => v[1] !== undefined)
);

const hydrateForeignDoc = ({ data, doc_holder }) => {
    const isList = Array.isArray(data);
    const filled = (isList ? data : [data]).map(v => {
        if (v?._foreign_doc) {
            v._foreign_doc = Array.isArray(v._foreign_doc)
                ? v._foreign_doc.map(k => doc_holder[k])
                : doc_holder[k];
        }
        return v;
    });
    return isList ? filled : filled[0];
}

const transformBSON = (d, castBSON) => {
    if (castBSON) return d && deserializeBSON(serializeToBase64({ _: d }), true)._;
    return cloneDeep(d);
};

const findObject = async (builder, config) => {
    const { projectUrl, serverE2E_PublicKey, dbUrl, dbName, maxRetries = 1, path, disableCache = false, uglify, extraHeaders, command, castBSON } = builder;
    const pureConfig = stripRequestConfig(config);
    validateFindObject(command);
    validateFindConfig(config);
    validateCollectionName(path);

    const { find, findOne, sort, direction, limit, random } = command;
    const { retrieval = RETRIEVAL.DEFAULT, episode = 0, disableAuth, disableMinimizer } = config || {};
    const enableMinimizer = !disableMinimizer;
    const accessId = await generateRecordID(builder, config, true);
    const processAccessId = `${accessId}_${limit}_${episode}_${projectUrl}_${dbUrl}_${dbName}_${retrieval}_${disableCache}`;
    const getRecordData = () => getRecord(builder, accessId, episode);
    const shouldCache = (retrieval !== RETRIEVAL.DEFAULT || !disableCache) &&
        ![RETRIEVAL.NO_CACHE_NO_AWAIT, RETRIEVAL.NO_CACHE_AWAIT].includes(retrieval);

    await awaitStore();

    let retries = 0, hasFinalize;

    const readValue = () => new Promise(async (resolve, reject) => {
        const retryProcess = ++retries,
            instantProcess = retryProcess === 1;

        const finalize = (a, b) => {
            const res = (instantProcess && a) ? transformBSON(a[0] || undefined, castBSON) : a;

            if (a) {
                resolve(instantProcess ? cloneDeep(res) : a);
            } else reject(instantProcess ? cloneDeep(b) : b);
            if (hasFinalize || !instantProcess) return;
            hasFinalize = true;

            if (enableMinimizer) {
                const resolutionList = (Scoped.PendingDbReadCollective[processAccessId] || []).slice(0);

                if (Scoped.PendingDbReadCollective[processAccessId])
                    delete Scoped.PendingDbReadCollective[processAccessId];

                resolutionList.forEach(e => {
                    e(a ? { result: res } : undefined, b);
                });
            }
        };

        try {
            if (instantProcess) {
                if (enableMinimizer) {
                    if (Scoped.PendingDbReadCollective[processAccessId]) {
                        Scoped.PendingDbReadCollective[processAccessId].push((a, b) => {
                            if (a) resolve(cloneDeep(a.result));
                            else reject(cloneDeep(b));
                        });
                        return;
                    }
                    Scoped.PendingDbReadCollective[processAccessId] = [];
                }

                const staleData = await getRecordData();
                if (retrieval.startsWith('sticky') && staleData) {
                    finalize(staleData);
                    if (retrieval !== RETRIEVAL.STICKY_RELOAD) return;
                }
            }

            if (!disableAuth && await getReachableServer(projectUrl))
                await awaitRefreshToken(projectUrl);

            const [reqBuilder, [privateKey]] = await buildFetchInterface({
                body: {
                    commands: stripUndefined({
                        config: pureConfig && serializeToBase64(pureConfig),
                        path,
                        find: serializeToBase64(findOne || find),
                        sort,
                        direction,
                        limit,
                        random
                    }),
                    ...dbName ? { dbName } : undefined,
                    ...dbUrl ? { dbUrl } : undefined
                },
                authToken: disableAuth ? undefined : Scoped.AuthJWTToken[projectUrl],
                serverE2E_PublicKey,
                uglify,
                extraHeaders
            });

            const data = await buildFetchResult(await fetch((findOne ? _readDocument : _queryCollection)(projectUrl, uglify), reqBuilder), uglify);

            const result = hydrateForeignDoc(
                deserializeBSON((uglify ? await deserializeE2E(data, serverE2E_PublicKey, privateKey) : data).result)._
            );

            if (shouldCache) insertRecord(builder, config, accessId, result, episode);
            finalize([result]);
        } catch (e) {
            let thisRecord;
            const getThisRecord = async () => thisRecord ? thisRecord[0] :
                (thisRecord = [await getRecordData()])[0];

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
                [
                    RETRIEVAL.DEFAULT,
                    RETRIEVAL.CACHE_NO_AWAIT,
                    RETRIEVAL.CACHE_AWAIT
                ].includes(retrieval) &&
                await getThisRecord()
            ) {
                finalize(await getThisRecord());
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

    return (await readValue());
};

const transformNullRecursively = obj => Object.fromEntries(
    Object.entries(obj).map(([k, v]) =>
        [k, [undefined, Infinity, NaN].includes(v) ? null : Validator.OBJECT(v) ? transformNullRecursively(v) : v]
    )
);

const cleanBatchWrite = (value) => cloneDeep(value).map(v => {
    if (Validator.OBJECT(v?.value)) {
        v.value = transformNullRecursively(v.value);
    } else if (Array.isArray(v?.value)) {
        v.value = v.value.map(e =>
            Validator.OBJECT(e) ? transformNullRecursively(e) : e
        );
    }
    return v;
});

const commitData = async (builder, value, type, config) => {
    // transform undefined
    if (Validator.OBJECT(value)) {
        value = value && deserializeBSON(serializeToBase64({ _: transformNullRecursively(value) }))._;
    } else if (type === 'batchWrite' && Array.isArray(value)) {
        value = deserializeBSON(
            serializeToBase64({
                _: cleanBatchWrite(value)
            })
        )._;
    }

    const { projectUrl, serverE2E_PublicKey, dbUrl, dbName, maxRetries = 1, path, find, disableCache, uglify, extraHeaders } = builder;
    const { disableAuth, delivery = DELIVERY.DEFAULT, stepping } = config || {};
    const writeId = `${Date.now() + ++Scoped.PendingIte}`;
    const isBatchWrite = type === 'batchWrite';
    const shouldCache = (delivery !== DELIVERY.DEFAULT || !disableCache) &&
        ![DELIVERY.NO_CACHE_AWAIT, DELIVERY.NO_CACHE_NO_AWAIT].includes();

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

            const [reqBuilder, [privateKey]] = await buildFetchInterface({
                body: {
                    commands: stripUndefined({
                        value: value && serializeToBase64({ _: value }),
                        ...isBatchWrite ? { stepping } : {
                            path,
                            scope: type,
                            find: find && serializeToBase64(find)
                        }
                    }),
                    ...dbName ? { dbName } : undefined,
                    ...dbUrl ? { dbUrl } : undefined
                },
                serverE2E_PublicKey,
                authToken: disableAuth ? undefined : Scoped.AuthJWTToken[projectUrl],
                uglify,
                extraHeaders
            });

            const data = await buildFetchResult(await fetch((isBatchWrite ? _writeMapDocument : _writeDocument)(projectUrl, uglify), reqBuilder), uglify);

            const f = uglify ? await deserializeE2E(data, serverE2E_PublicKey, privateKey) : data;

            finalize({ ...f.statusData }, undefined, { removeCache: true });
        } catch (e) {
            if (e?.simpleError) {
                console.error(`${type} error (${path}), ${e.simpleError?.message}`);
                finalize(undefined, e?.simpleError, { removeCache: true, revertCache: true });
            } else if (delivery === DELIVERY.NO_CACHE_NO_AWAIT) {
                finalize(undefined, simplifyCaughtError(e).simpleError);
            } else if (retries > maxRetries) {
                finalize(
                    undefined,
                    { error: 'retry_limit_exceeded', message: `retry exceed limit(${maxRetries})` },
                    { removeCache: true, revertCache: true }
                );
            } else {
                if (delivery === DELIVERY.NO_CACHE_AWAIT) {
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

    return (await sendValue());
};

export const trySendPendingWrite = (projectUrl) => {
    if (Scoped.dispatchingWritesPromise) return;

    Scoped.dispatchingWritesPromise = new Promise(async resolve => {
        const sortedWrite = Object.entries(CacheStore.PendingWrites[projectUrl] || {})
            .filter(([k]) => !Scoped.OutgoingWrites[k])
            .sort((a, b) => a[1].addedOn - b[1].addedOn);
        let resolveCounts = 0;

        for (const [writeId, { snapshot, builder, attempts = 1 }] of sortedWrite) {
            try {
                await commitData(builder, snapshot.value, snapshot.type, { ...snapshot.config, delivery: DELIVERY.NO_CACHE_NO_AWAIT });
                delete CacheStore.PendingWrites[projectUrl][writeId];
                ++resolveCounts;
            } catch (_) {
                const { maxRetries } = builder;
                if (!maxRetries || attempts >= maxRetries) {
                    delete CacheStore.PendingWrites[projectUrl][writeId];
                    ++resolveCounts;
                } else if (CacheStore.PendingWrites[projectUrl]?.[writeId]) {
                    CacheStore.PendingWrites[projectUrl][writeId].attempts = attempts + 1;
                }
            }
        }
        resolve();
        Scoped.dispatchingWritesPromise = undefined;
        if (
            (sortedWrite.length - resolveCounts) &&
            await getReachableServer(projectUrl)
        ) trySendPendingWrite(projectUrl);
    });
};