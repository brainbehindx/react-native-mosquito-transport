import AsyncStorage from "@react-native-async-storage/async-storage";
import { StoreReadyListener } from "./listeners";
import { CACHE_STORAGE_PATH } from "./values";
import { CacheStore, Scoped } from "./variables";

export const updateCacheStore = () => {
    clearTimeout(Scoped.cacheStorageReducer);
    Scoped.cacheStorageReducer = setTimeout(() => {
        AsyncStorage.setItem(CACHE_STORAGE_PATH, JSON.stringify({
            DatabaseStore: CacheStore.DatabaseStore,
            DatabaseRecords: CacheStore.DatabaseRecords,
            AuthStore: CacheStore.AuthStore,
            PendingWrites: CacheStore.PendingWrites
        }))
    }, 500);
}

export const releaseCacheStore = () => {
    AsyncStorage.getItem(CACHE_STORAGE_PATH, (_, res) => {
        const j = JSON.parse(res || '{}');

        console.log('mosquitoCache: ', JSON.stringify(j));
        Object.keys(j).forEach(e => {
            CacheStore[e] = j[e];
        });
        Object.entries(CacheStore.AuthStore).forEach(([key, value]) => {
            Scoped.AuthJWTToken[key] = value?.token;
        });
        Scoped.IsStoreReady = true;
        StoreReadyListener.triggerListener('ready');
        // TODO: commit pending write
    });
}

export const awaitStore = () => new Promise(resolve => {
    if (Scoped.IsStoreReady) {
        resolve();
        return;
    }
    const l = StoreReadyListener.startListener(t => {
        if (t === 'ready') {
            resolve();
            l();
        }
    }, true);
});

export const buildFetchInterface = (body, accessKey, authToken, method) => ({
    body: JSON.stringify({ ...body }),
    headers: {
        'Content-type': 'application/json',
        'Authorization': `Bearer ${btoa(accessKey)}`,
        ...(authToken ? { 'Mosquitodb-Token': authToken } : {})
    },
    method: method || 'POST'
});

export const simplifyError = (error, message) => ({
    simpleError: { error, message }
});