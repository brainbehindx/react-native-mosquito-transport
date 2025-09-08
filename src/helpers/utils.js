import { ServerReachableListener, StoreReadyListener } from "./listeners";
import { CacheStore, Scoped } from "./variables";
import { serializeE2E } from "./peripherals";
import { DatastoreParser } from "../products/database/bson";
import { deserialize } from "entity-serializer";
import { breakDbMap, purgeRedundantRecords } from "./purger";
import { FS_PATH, getSystem } from "./fs_manager";
import { Buffer } from "buffer";
import { basicClone } from "./basic_clone";

const { FILE_NAME, TABLE_NAME } = FS_PATH;

const CacheKeys = Object.keys(CacheStore);

const prefillDatastore = (obj, caller) => {
    obj = basicClone(obj);
    breakDbMap(obj, (_projectUrl, _dbUrl, _dbName, _path, value) => {
        Object.entries(value.instance).forEach(([access_id, obj]) => {
            value.instance[access_id] = caller(obj);
        });
        Object.entries(value.episode).forEach(([_access_id, limitObj]) => {
            Object.entries(limitObj).forEach(([limit, obj]) => {
                limitObj[limit] = caller(obj);
            });
        });
    });
    return obj;
};

const prefillFetcher = (store, encode) => {
    store = basicClone(store);
    Object.values(store).forEach(accessIdObj => {
        Object.values(accessIdObj).forEach(value => {
            value.data.buffer = encode ?
                Buffer.from(value.data.buffer).toString('base64')
                : Buffer.from(value.data.buffer, 'base64');
        });
    });
    return store;
}

export const updateCacheStore = async (node) => {
    node = node && node.filter((v, i, a) => a.indexOf(v) === i);
    const { io, promoteCache } = Scoped.ReleaseCacheData;

    const {
        AuthStore,
        EmulatedAuth,
        PendingAuthPurge,
        DatabaseStore,
        PendingWrites,
        FetchedStore,
        ...restStore
    } = CacheStore;

    const minimizePendingWrite = () => {
        const obj = basicClone(PendingWrites);
        Object.values(obj).forEach(e => {
            Object.values(e).forEach(b => {
                if ('editions' in b) delete b.editions;
            });
        });
        return obj;
    }

    if (io) {
        const txt = JSON.stringify({
            AuthStore,
            EmulatedAuth,
            PendingAuthPurge,
            ...promoteCache ? {
                DatabaseStore: prefillDatastore(DatabaseStore, DatastoreParser.encode),
                PendingWrites: minimizePendingWrite(),
                FetchedStore: prefillFetcher(FetchedStore, true)
            } : {},
            ...promoteCache ? restStore : {}
        });

        io.output(txt, node);
    } else {
        // use fs
        const exclusion = ['DatabaseStore', 'DatabaseCountResult', 'FetchedStore'];
        const updationKey = (node ? Array.isArray(node) ? node : [node] : CacheKeys).filter(v => !exclusion.includes(v));

        if (!updationKey.length) return;
        await Promise.all(
            updationKey
                .map(v => [v, v === 'PendingWrites' ? minimizePendingWrite() : CacheStore[v]])
                .map(([ref, value]) =>
                    getSystem(FILE_NAME).set(TABLE_NAME, ref, { value })
                )
        ).catch(err => {
            console.error('updateCacheStore err:', err);
        });
    }
};

export const releaseCacheStore = async (builder) => {
    const { io } = builder;

    let data = {};
    const tobePurged = [];

    try {
        if (io) {
            data = JSON.parse((await io.input()) || '{}');

            if (data.DatabaseStore)
                data.DatabaseStore = prefillDatastore(
                    data.DatabaseStore,
                    r => DatastoreParser.decode(r, false)
                );
            if (data.FetchedStore)
                data.FetchedStore = prefillFetcher(data.FetchedStore, false);
        } else {
            const query = await getSystem(FILE_NAME).list(TABLE_NAME, ['value']).catch(() => []);
            data = Object.fromEntries(
                query.map(([ref, { value }]) =>
                    [ref, value]
                )
            );
        }
        await purgeRedundantRecords(data, builder, purgeNodes => {
            tobePurged.push(...purgeNodes);
        });
    } catch (e) {
        console.error('releaseCacheStore data err:', e);
    }

    Object.entries(data).forEach(([k, v]) => {
        CacheStore[k] = v;
    });
    Object.entries(CacheStore.AuthStore).forEach(([key, value]) => {
        Scoped.AuthJWTToken[key] = value?.token;
    });
    Scoped.IsStoreReady = true;
    StoreReadyListener.dispatch('_', 'ready');
    setTimeout(() => {
        if (tobePurged.length) updateCacheStore(tobePurged);
    }, 0);
};

export const getPrefferTime = () => Date.now() + (Scoped.serverTimeOffset || 0);

export const awaitStore = () => new Promise(resolve => {
    if (Scoped.IsStoreReady) {
        resolve();
        return;
    }
    const l = StoreReadyListener.listenTo('_', t => {
        if (t === 'ready') {
            resolve();
            l();
        }
    }, true);
});

export const awaitReachableServer = (projectUrl) => new Promise(resolve => {
    if (Scoped.IS_CONNECTED[projectUrl]) {
        resolve();
        return;
    }
    const l = ServerReachableListener.listenTo(projectUrl, t => {
        if (t) {
            resolve();
            l();
        }
    }, true);
});

export const getReachableServer = (projectUrl) => new Promise(resolve => {
    if (typeof Scoped.IS_CONNECTED[projectUrl] === 'boolean') {
        resolve(Scoped.IS_CONNECTED[projectUrl]);
        return;
    }
    const l = ServerReachableListener.listenTo(projectUrl, t => {
        if (typeof t === 'boolean') {
            resolve(t);
            l();
        }
    }, true);
});

export const buildFetchInterface = async ({ body, authToken, method, uglify, serverE2E_PublicKey, extraHeaders }) => {
    if (!uglify) body = JSON.stringify({ ...body });
    const [plate, keyPair] = uglify ? await serializeE2E(body, authToken, serverE2E_PublicKey) : [undefined, []];

    return [{
        body: uglify ? plate : body,
        headers: {
            ...extraHeaders,
            'Content-type': uglify ? 'request/buffer' : 'application/json',
            ...(authToken && !uglify) ? { 'mtoken': authToken } : {}
        },
        method: method || 'POST',
        credentials: 'omit'
    }, keyPair];
};

export const buildFetchResult = async (fetchRef, ugly) => {
    if (ugly) {
        const [data, simpleError] = deserialize(await fetchRef.arrayBuffer());
        if (simpleError) throw simpleError;
        return data;
    }
    const json = await fetchRef.json();
    if (json.simpleError) throw json;
    return json;
};