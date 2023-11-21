import 'react-native-get-random-values';
import { IS_WHOLE_NUMBER, listenReachableServer } from "./helpers/peripherals";
import { releaseCacheStore } from "./helpers/utils";
import { Scoped } from "./helpers/variables";
import { MosquitoDbAuth } from "./products/auth";
import { MosquitoDbCollection } from "./products/database";
import { MosquitoDbStorage } from "./products/storage";
import { ServerReachableListener, TokenRefreshListener } from "./helpers/listeners";
import { initTokenRefresher, triggerAuth, triggerAuthToken } from "./products/auth/accessor";
import { TIMESTAMP, DOCUMENT_EXTRACTION, FIND_GEO_JSON, GEO_JSON } from "./products/database/types";
import { mfetch } from "./products/http_callable";
import { io } from "socket.io-client";
import { validateCollectionPath } from "./products/database/validator";
import { CACHE_PROTOCOL } from "./helpers/values";
import { trySendPendingWrite } from "./products/database/accessor";

class RNMosquitoDb {
    constructor(config) {
        validateMosquitoDbConfig(config);
        this.config = {
            ...config,
            uglify: config.uglifyRequest,
            apiUrl: config.projectUrl,
            projectUrl: config.projectUrl.split('/').filter((_, i, a) => i !== a.length - 1).join('/')
        };
        if (!Scoped.ReleaseCacheData)
            throw `releaseCache must be called before creating any mosquitodb instance`;

        const { projectUrl } = this.config;

        if (!Scoped.InitializedProject[projectUrl]) {
            Scoped.InitializedProject[projectUrl] = true;
            Scoped.LastTokenRefreshRef[projectUrl] = 0;
            triggerAuth(projectUrl);
            triggerAuthToken(projectUrl);
            initTokenRefresher({ ...this.config }, true);

            const socket = io(`ws://${projectUrl.split('://')[1]}`);

            socket.on('connect', () => {
                ServerReachableListener.dispatch(projectUrl, true);
            });
            socket.on('disconnect', () => {
                ServerReachableListener.dispatch(projectUrl, false);
            });

            listenReachableServer(c => {
                Scoped.IS_CONNECTED[projectUrl] = c;
                if (c) trySendPendingWrite();
            }, projectUrl);

            TokenRefreshListener.listenTo(projectUrl, v => {
                Scoped.IS_TOKEN_READY[projectUrl] = v;
            });
        }
    }

    static releaseCache(prop) {
        if (Scoped.ReleaseCacheData) throw `calling releaseCache multiple times is prohibited`;
        validateReleaseCacheProp({ ...prop });
        Scoped.ReleaseCacheData = { ...prop };
        releaseCacheStore({ ...prop });
    }

    getDatabase = (dbName, dbUrl) => ({
        collection: (path) => new MosquitoDbCollection({
            ...this.config,
            path,
            ...(dbName ? { dbName } : {}),
            ...(dbUrl ? { dbUrl } : {})
        })
    });
    collection = (path) => {
        validateCollectionPath(path);
        return new MosquitoDbCollection({ ...this.config, path });
    }
    auth = () => new MosquitoDbAuth({ ...this.config });
    storage = () => new MosquitoDbStorage({ ...this.config });
    fetchHttp = (endpoint, init, config) => mfetch(endpoint, init, { ...this.config, method: config });
    listenReachableServer = (callback) => listenReachableServer(callback, this.config.projectUrl);
    wipeDatabaseCache = () => {

    }
}

const validateReleaseCacheProp = (prop) => {
    const cacheList = [...Object.values(CACHE_PROTOCOL)];

    Object.entries(prop).forEach(([k, v]) => {
        if (k === 'cachePassword') {
            if (typeof v !== 'string' || v.trim().length <= 0)
                throw `Invalid value supplied to cachePassword, value must be a string and greater than 0 characters`;
        } else if (k === 'cacheProtocol') {
            if (!cacheList.includes(`${v}`)) throw `unknown value supplied to ${k}, expected any of ${cacheList}`;
        } else throw `Unexpected property named ${k}`;
    });
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
        if (typeof v !== 'number' || v <= 0 || !IS_WHOLE_NUMBER(v))
            throw `Invalid value supplied to maxRetries, value must be whole number and greater than zero`;
    },
    uglifyRequest: () => {
        if (typeof v !== 'boolean')
            throw `Invalid value supplied to uglifyRequest, value must be a boolean`;
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
    TIMESTAMP,
    DOCUMENT_EXTRACTION,
    FIND_GEO_JSON,
    GEO_JSON
};

export default RNMosquitoDb;