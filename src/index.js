import 'react-native-get-random-values';
import { IS_WHOLE_NUMBER, encryptString, listenReachableServer } from "./helpers/peripherals";
import { releaseCacheStore } from "./helpers/utils";
import { CacheStore, Scoped } from "./helpers/variables";
import { MosquitoDbAuth } from "./products/auth";
import { MosquitoDbCollection } from "./products/database";
import { MosquitoDbStorage } from "./products/storage";
import { ServerReachableListener, TokenRefreshListener } from "./helpers/listeners";
import { awaitRefreshToken, initTokenRefresher, listenToken, listenTokenReady, triggerAuth, triggerAuthToken } from "./products/auth/accessor";
import { TIMESTAMP, DOCUMENT_EXTRACTION, FIND_GEO_JSON, GEO_JSON } from "./products/database/types";
import { mfetch } from "./products/http_callable";
import { io } from "socket.io-client";
import { validateCollectionPath } from "./products/database/validator";
import { CACHE_PROTOCOL } from "./helpers/values";
import { trySendPendingWrite } from "./products/database/accessor";
import EngineApi from './helpers/EngineApi';
import { parse, stringify } from 'json-buffer';

const {
    _listenCollection,
    _listenDocument,
    _startDisconnectWriteTask,
    _cancelDisconnectWriteTask,
    _listenUserVerification
} = EngineApi;

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
    getSocket = (configOpts) => {
        const { disableAuth } = configOpts || {},
            { projectUrl, uglify, accessKey } = this.config;

        const restrictedRoute = [
            _listenCollection,
            _listenDocument,
            _startDisconnectWriteTask,
            _cancelDisconnectWriteTask,
            _listenUserVerification
        ];

        let socketReadyCallback,
            makeSocketCallback = () => new Promise(resolve => {
                socketReadyCallback = resolve;
            }),
            socketReadyPromise = makeSocketCallback(),
            socketListenerList = [],
            socketListenerIte = 0;

        let hasCancelled,
            socket,
            tokenListener;

        const emit = ({ timeout, promise, emittion: emittionx }) => new Promise(async (resolve, reject) => {
            const [route, ...emittion] = emittionx;

            if (typeof route !== 'string')
                throw `expected ${promise ? 'emitWithAck' : 'emit'} first argument to be a string type`;

            if (restrictedRoute.includes(route))
                throw `${route} is a restricted socket path, avoid using any of ${restrictedRoute}`;

            let hasResolved, stime = Date.now();

            const timer = isNaN(timeout) ? undefined : setTimeout(() => {
                hasResolved = true;
                reject(new Error('emittion timeout'));
            }, timeout);

            if (hasResolved) return;
            clearTimeout(timer);
            await socketReadyPromise;

            try {
                const h = isNaN(timeout) ? socket : socket.timeout(timeout - (Date.now() - stime)),
                    { encryptionKey = accessKey } = CacheStore.AuthStore?.[projectUrl]?.tokenData || {};

                const lastEmit = emittion.slice(-1)[0],
                    mit = typeof lastEmit === 'function' ? emittion.slice(0, emittion.length - 1) : emittion;

                const p = await h[promise ? 'emitWithAck' : 'emit'](route,
                    uglify ? [
                        encryptString(stringify(mit), accessKey, disableAuth ? accessKey : encryptionKey)
                    ] : mit,
                    typeof lastEmit === 'function' ? function () {
                        lastEmit(...[...arguments]);
                    } : undefined
                );
                resolve(promise ? p : undefined);
            } catch (e) {
                reject(e);
            }
        });

        const init = async () => {
            if (hasCancelled) return;

            const mtoken = disableAuth ? undefined : Scoped.AuthJWTToken[projectUrl];
            socket = io(`ws://${projectUrl.split('://')[1]}`, {
                auth: {
                    ...mtoken ? { mtoken } : {},
                    ugly: uglify,
                    isOutsider: true,
                    accessKey: encryptString(accessKey, accessKey, '_')
                }
            });

            socketReadyCallback();
            socketListenerList.forEach(([_, method, route, callback]) => {
                socket[method](route, callback);
            });
        }

        if (disableAuth) {
            init();
        } else {
            let lastTokenStatus;

            tokenListener = listenTokenReady(status => {
                if (lastTokenStatus === (status || false)) return;

                if (status === 'ready') {
                    init();
                } else {
                    socket?.close?.();
                    socket = undefined;
                    socketReadyPromise = makeSocketCallback();
                }
                lastTokenStatus = status || false;
            }, projectUrl);
        }

        return {
            timeout: (timeout) => ({
                emitWithAck: function () {
                    return emit({
                        timeout,
                        promise: true,
                        emittion: [...arguments]
                    });
                }
            }),
            emit: function () { emit({ emittion: [...arguments] }) },
            emitWithAck: function () {
                return emit({
                    emittion: [...arguments],
                    promise: true
                });
            },
            on: async (route, callback) => {
                if (restrictedRoute.includes(route))
                    throw `${route} is a restricted socket path, avoid using any of ${restrictedRoute}`;
                const ref = ++socketListenerIte;
                socketListenerList.push([ref, 'on', route, callback]);
                if (socket) socket.on(route, callback);

                return () => {
                    if (socket) socket.off(route, callback);
                    socketListenerList = socketListenerList.filter(([id]) => id !== ref);
                }
            },
            once: async (route, callback) => {
                if (restrictedRoute.includes(route))
                    throw `${route} is a restricted socket path, avoid using any of ${restrictedRoute}`;
                const ref = ++socketListenerIte;
                socketListenerList.push([ref, 'once', route, callback]);
                if (socket) socket.once(route, callback);

                return () => {
                    if (socket) socket.off(route, callback);
                    socketListenerList = socketListenerList.filter(([id]) => id !== ref);
                }
            },
            destroy: () => {
                hasCancelled = true;
                tokenListener?.();
                if (socket) socket.close();
                socketListenerList = undefined;
            }
        }
    }

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