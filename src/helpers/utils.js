import AsyncStorage from "@react-native-async-storage/async-storage";
import { ServerReachableListener, StoreReadyListener } from "./listeners";
import { CACHE_PROTOCOL, CACHE_STORAGE_PATH, DEFAULT_CACHE_PASSWORD, LOCAL_STORAGE_PATH } from "./values";
import { CacheStore, Scoped } from "./variables";
import { decryptString, encryptString, niceTry, serializeE2E } from "./peripherals";
import { deserializeBSON, serializeToBase64 } from "../products/database/bson";
import { trySendPendingWrite } from "../products/database";
import { deserialize } from "entity-serializer";

export const updateCacheStore = (timer = 300) => {
    const { cachePassword = DEFAULT_CACHE_PASSWORD, cacheProtocol = CACHE_PROTOCOL.ASYNC_STORAGE, io, promoteCache } = Scoped.ReleaseCacheData;

    clearTimeout(Scoped.cacheStorageReducer);
    Scoped.cacheStorageReducer = setTimeout(() => {
        const { AuthStore, DatabaseStore, PendingWrites, ...restStore } = CacheStore;

        const txt = encryptString(
            JSON.stringify({
                AuthStore,
                ...promoteCache ? {
                    DatabaseStore: serializeToBase64(DatabaseStore),
                    PendingWrites: serializeToBase64(PendingWrites)
                } : {},
                ...promoteCache ? restStore : {}
            }),
            cachePassword,
            cachePassword
        );

        if (io) {
            io.output(txt);
        } else if (cacheProtocol === CACHE_PROTOCOL.ASYNC_STORAGE) {
            AsyncStorage.setItem(CACHE_STORAGE_PATH, txt);
        } else if (cacheProtocol === CACHE_PROTOCOL.SQLITE) {
            console.error('unsupported protocol "sqlite"');
        } else {
            const fs = require('react-native-fs');
            fs.writeFile(LOCAL_STORAGE_PATH(), txt, 'utf8');
        }
    }, timer);
};

export const releaseCacheStore = async (builder) => {
    const { cachePassword = DEFAULT_CACHE_PASSWORD, cacheProtocol = CACHE_PROTOCOL.ASYNC_STORAGE, io } = builder;

    let txt;

    if (io) {
        txt = await io.input();
    } else if (cacheProtocol === CACHE_PROTOCOL.ASYNC_STORAGE) {
        txt = await niceTry(() => AsyncStorage.getItem(CACHE_STORAGE_PATH));
    } else {
        const fs = require('react-native-fs');
        txt = await niceTry(() => fs.readFile(LOCAL_STORAGE_PATH(), 'utf8'));
    }

    const j = JSON.parse(decryptString(txt || '', cachePassword, cachePassword) || '{}');
    const projectList = new Set([]);

    Object.entries(j).forEach(([k, v]) => {
        if (['DatabaseStore', 'PendingWrites'].includes(k)) {
            CacheStore[k] = deserializeBSON(v);
        } else CacheStore[k] = v;
        projectList.add(k);
    });
    Object.entries(CacheStore.AuthStore).forEach(([key, value]) => {
        Scoped.AuthJWTToken[key] = value?.token;
    });
    projectList.forEach(projectUrl => {
        if (Scoped.IS_CONNECTED[projectUrl])
            trySendPendingWrite(projectUrl);
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

export const buildFetchInterface = async ({ body, accessKey, authToken, method, uglify, serverE2E_PublicKey, extraHeaders }) => {
    if (!uglify) body = JSON.stringify({ ...body });
    const [plate, keyPair] = uglify ? await serializeE2E(body, authToken, serverE2E_PublicKey) : [undefined, []];

    return [{
        body: uglify ? plate : body,
        cache: 'no-cache',
        headers: {
            'Content-type': uglify ? 'request/buffer' : 'application/json',
            'Authorization': accessKey,
            ...(authToken && !uglify) ? { 'Mosquito-Token': authToken } : {},
            ...extraHeaders
        },
        method: method || 'POST'
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