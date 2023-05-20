import { listenConnection } from "./src/helpers/peripherals";
import { releaseCacheStore } from "./src/helpers/utils";
import { Scoped } from "./src/helpers/variables";
import { MosquitoDbAuth } from "./src/products/auth";
import { MosquitoDbCollection } from "./src/products/database";
import { MosquitoDbStorage } from "./src/products/storage";
import { encode, decode } from 'base-64';
import { AuthListener, AuthTokenListener, TokenRefreshListener } from "./src/helpers/listeners";
import GlobalListener from "./src/helpers/GlobalListener";
import { initTokenRefresher, triggerAuth, triggerAuthToken } from "./src/products/auth/accessor";

globalThis.btoa = encode;
globalThis.atob = decode;

releaseCacheStore();

listenConnection(c => {
    Scoped.IS_CONNECTED = c;
});

class RNMosquitoDb {
    constructor(config) {
        validateMosquitoDbConfig(config);
        this.config = config;

        const { projectUrl } = config;

        if (!AuthListener[projectUrl]) {
            AuthListener[projectUrl] = new GlobalListener('loading');
            AuthTokenListener[projectUrl] = new GlobalListener('loading');
            TokenRefreshListener[projectUrl] = new GlobalListener();
            Scoped.LastTokenRefreshRef[projectUrl] = 0;
            triggerAuth(projectUrl);
            triggerAuthToken(projectUrl);
            initTokenRefresher({ ...config }, true);
        }
    }

    getDatabase = (dbName, dbUrl) => ({
        collection: (path) => new MosquitoDbCollection({
            ...this.config,
            path,
            ...(dbName ? { dbName } : {}),
            ...(dbUrl ? { dbUrl } : {})
        })
    });
    collection = (path) => new MosquitoDbCollection({ ...this.config, path })
    auth = () => new MosquitoDbAuth({ ...this.config })
    storage = () => new MosquitoDbStorage({ ...this.config })
}

const validator = {
    dbName: (v) => {
        if (typeof v !== 'string' || !v.trim())
            throw `Invalid value supplied to dbName, value must be string and greater than one`;
    },
    dbUrl: (v) => {
        if (typeof v !== 'string' || !v.trim())
            throw `Invalid value supplied to dbUrl, value must be string and greater than one`;
    },
    heapMemory: (v) => {
        if (typeof v !== 'number' || v <= 0)
            throw `Invalid value supplied to heapMemory, value must be number and greater than zero`;
    },
    projectUrl: (v) => {
        if (typeof v !== 'string' || !v.trim())
            throw `Invalid value supplied to projectUrl, value must be a string and greater than one`;
    },
    disableCache: (v) => {
        if (typeof v !== 'boolean')
            throw `Invalid value supplied to disableCache, value must be a boolean`;
    },
    accessKey: (v) => {
        if (typeof v !== 'string' || !v.trim())
            throw `Invalid value supplied to accessKey, value must be a string and greater than one`;
    },
    maxRetries: (v) => {
        if (typeof v !== 'number' || v <= 0)
            throw `Invalid value supplied to maxRetries, value must be number and greater than zero`;
    }
};

const validateMosquitoDbConfig = (config) => {
    if (typeof config !== 'object') throw 'mosquitoDB config is not an object';
    const h = Object.keys(config);

    for (let i = 0; i < h.length; i++) {
        const k = h[i];

        if (!validator[k]) throw `Unexpected property named ${k}`;
        validator[k](config[k]);
    }

    if (!config['projectUrl']) throw 'projectUrl is a required property in MosquitoDb() constructor';
    if (!config['accessKey']) throw 'accessKey is a required property in MosquitoDb() constructor';
}

export default RNMosquitoDb;