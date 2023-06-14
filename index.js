import { listenReachableServer } from "./src/helpers/peripherals";
import { releaseCacheStore } from "./src/helpers/utils";
import { Scoped } from "./src/helpers/variables";
import { MosquitoDbAuth } from "./src/products/auth";
import { MosquitoDbCollection } from "./src/products/database";
import { MosquitoDbStorage } from "./src/products/storage";
import { encode, decode } from 'base-64';
import { InitializedProject, ServerReachableListener } from "./src/helpers/listeners";
import { initTokenRefresher, triggerAuth, triggerAuthToken } from "./src/products/auth/accessor";
import { FIELD_DELETION, INCREMENT, TIMESTAMP } from "./src/products/database/types";
import { mfetch } from "./src/products/http_callable";
import { io } from "socket.io-client";

globalThis.btoa = encode;
globalThis.atob = decode;

releaseCacheStore();

class RNMosquitoDb {
    constructor(config) {
        validateMosquitoDbConfig(config);
        this.config = {
            ...config,
            apiUrl: config.projectUrl,
            projectUrl: config.projectUrl.split('/').filter((_, i, a) => i !== a.length - 1).join('/')
        };

        const { projectUrl } = this.config;

        if (!InitializedProject[projectUrl]) {
            InitializedProject[projectUrl] = true;
            Scoped.LastTokenRefreshRef[projectUrl] = 0;
            triggerAuth(projectUrl);
            triggerAuthToken(projectUrl);
            initTokenRefresher({ ...this.config }, true);

            const socket = io(`ws://${projectUrl.split('://')[1]}`);

            socket.on('connect', () => {
                ServerReachableListener.triggerKeyListener(projectUrl, true);
            });
            socket.on('disconnect', () => {
                ServerReachableListener.triggerKeyListener(projectUrl, false);
            });

            listenReachableServer(c => {
                Scoped.IS_CONNECTED[projectUrl] = c;
            }, projectUrl);
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
    collection = (path) => new MosquitoDbCollection({ ...this.config, path });
    auth = () => new MosquitoDbAuth({ ...this.config });
    storage = () => new MosquitoDbStorage({ ...this.config });
    fetchHttp = (endpoint, init) => mfetch(endpoint, init, { ...this.config });
    listenReachableServer = (callback) => listenReachableServer(callback, this.config.projectUrl);
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
    },
    awaitStorage: (v) => {
        if (v !== undefined && typeof v !== 'boolean')
            throw `Invalid value supplied to awaitStorage, expected a boolean but got ${v}`;
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

export {
    FIELD_DELETION,
    INCREMENT,
    TIMESTAMP
}

export default RNMosquitoDb;