import { ServerReachableListener, StoreReadyListener } from "./listeners";
import { CacheStore, Scoped } from "./variables";
import { serializeE2E } from "./peripherals";
import { deserializeBSON, serializeToBase64 } from "../products/database/bson";
import { deserialize } from "entity-serializer";
import { purgeRedundantRecords } from "./purger";
import { FS_PATH, getSystem } from "./fs_manager";

const { FILE_NAME, TABLE_NAME } = FS_PATH;

const CacheKeys = Object.keys(CacheStore);

export const updateCacheStore = async (node) => {
    const { io, promoteCache } = Scoped.ReleaseCacheData;

    const {
        AuthStore,
        EmulatedAuth,
        PendingAuthPurge,
        DatabaseStore,
        PendingWrites,
        ...restStore
    } = CacheStore;

    if (io) {
        const txt = JSON.stringify({
            AuthStore,
            EmulatedAuth,
            PendingAuthPurge,
            ...promoteCache ? {
                DatabaseStore: serializeToBase64(DatabaseStore),
                PendingWrites: serializeToBase64(PendingWrites)
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
                .map(v => [v, v === 'PendingWrites' ? serializeToBase64(CacheStore[v]) : CacheStore[v]])
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

    try {
        if (io) {
            data = JSON.parse((await io.input()) || '{}');
        } else {
            try {
                const query = await getSystem(FILE_NAME).list(TABLE_NAME, ['value']).catch(() => []);
                data = Object.fromEntries(
                    query.map(([ref, { value }]) =>
                        [ref, value]
                    )
                );
            } catch (error) {
                console.error('initializeCache data release err:', error);
            }
        }
        await purgeRedundantRecords(data, builder);
    } catch (e) {
        console.error('initializeCache data err:', e);
    }

    Object.entries(data).forEach(([k, v]) => {
        if (['DatabaseStore', 'PendingWrites'].includes(k)) {
            CacheStore[k] = deserializeBSON(v, true);
        } else CacheStore[k] = v;
    });
    Object.entries(CacheStore.AuthStore).forEach(([key, value]) => {
        Scoped.AuthJWTToken[key] = value?.token;
    });
    Scoped.IsStoreReady = true;
    StoreReadyListener.dispatch('_', 'ready');
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
        // cache: 'no-cache',
        headers: {
            ...extraHeaders,
            'Content-type': uglify ? 'request/buffer' : 'application/json',
            ...(authToken && !uglify) ? { 'Mosquito-Token': authToken } : {}
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