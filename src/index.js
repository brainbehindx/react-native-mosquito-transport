import 'react-native-get-random-values';
import { IS_WHOLE_NUMBER, deserializeE2E, listenReachableServer, serializeE2E } from "./helpers/peripherals";
import { releaseCacheStore } from "./helpers/utils";
import { Scoped } from "./helpers/variables";
import { MTAuth } from "./products/auth";
import { MTCollection, batchWrite } from "./products/database";
import { MTStorage } from "./products/storage";
import { ServerReachableListener, TokenRefreshListener } from "./helpers/listeners";
import { initTokenRefresher, listenTokenReady, triggerAuthToken } from "./products/auth/accessor";
import { TIMESTAMP, DOCUMENT_EXTRACTION, FIND_GEO_JSON, GEO_JSON } from "./products/database/types";
import { mfetch } from "./products/http_callable";
import { io } from "socket.io-client";
import { validateCollectionPath } from "./products/database/validator";
import { CACHE_PROTOCOL, Regexs } from "./helpers/values";
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

class RNMT {
    constructor(config) {
        validateMTConfig(config, this);
        this.config = {
            ...config,
            uglify: config.enableE2E_Encryption,
            apiUrl: config.projectUrl,
            projectUrl: config.projectUrl.split('/').slice(0, -1).join('/')
        };
        const { projectUrl } = this.config;

        this.config.baseUrl = projectUrl.split('://')[1];

        if (!Scoped.ReleaseCacheData)
            throw `releaseCache must be called before creating any ${this.constructor.name} instance`;

        if (!Scoped.InitializedProject[projectUrl]) {
            Scoped.InitializedProject[projectUrl] = true;
            Scoped.LastTokenRefreshRef[projectUrl] = 0;
            triggerAuthToken(projectUrl);
            initTokenRefresher({ ...this.config }, true);

            const socket = io(`ws://${projectUrl.split('://')[1]}`, {
                auth: { _m_internal: true }
            });

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
        if (Scoped.ReleaseCacheData) throw `calling ${this.name} multiple times is prohibited`;
        validateReleaseCacheProp({ ...prop });
        Scoped.ReleaseCacheData = { ...prop };
        releaseCacheStore({ ...prop });
    }

    getDatabase = (dbName, dbUrl) => ({
        collection: (path) => new MTCollection({
            ...this.config,
            path,
            ...(dbName ? { dbName } : {}),
            ...(dbUrl ? { dbUrl } : {})
        })
    });
    collection = (path) => {
        validateCollectionPath(path);
        return new MTCollection({ ...this.config, path });
    }
    batchWrite = (map, configx) => batchWrite({ ...this.config }, map, configx);
    auth = () => new MTAuth({ ...this.config });
    storage = () => new MTStorage({ ...this.config });
    fetchHttp = (endpoint, init, config) => mfetch(endpoint, init, { ...this.config, method: config });
    listenReachableServer = (callback) => listenReachableServer(callback, this.config.projectUrl);

    getSocket = (configOpts) => {
        const { disableAuth, authHandshake } = configOpts || {},
            { projectUrl, uglify, accessKey, serverE2E_PublicKey } = this.config;

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
            tokenListener,
            clientPrivateKey;

        const listenerCallback = (callback) => function () {
            const [args, ...restArgs] = [...arguments];
            let res;

            if (uglify) {
                res = parse(deserializeE2E(args, serverE2E_PublicKey, clientPrivateKey));
            } else res = args;

            callback?.(...res || [], ...typeof restArgs[0] === 'function' ? [function () {
                const args = [...arguments];
                let res;

                if (uglify) {
                    res = serializeE2E(stringify(args), undefined, serverE2E_PublicKey)[0];
                } else res = args;

                restArgs[0](res);
            }] : []);
        }

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

            await socketReadyPromise;
            if (hasResolved) return;
            clearTimeout(timer);

            try {
                const h = isNaN(timeout) ? socket : socket.timeout(timeout - (Date.now() - stime));

                const lastEmit = emittion.slice(-1)[0],
                    mit = typeof lastEmit === 'function' ? emittion.slice(0, -1) : emittion;

                const [reqBuilder, [privateKey]] = uglify ? serializeE2E(stringify(mit), undefined, serverE2E_PublicKey) : [undefined, []];

                if (typeof lastEmit === 'function' && promise)
                    throw 'emitWithAck cannot have function in it parameter';

                const p = await h[promise ? 'emitWithAck' : 'emit'](route,
                    ...uglify ? [reqBuilder] : [mit],
                    ...typeof lastEmit === 'function' ? [function () {
                        const args = [...arguments][0];
                        let res;

                        if (uglify) {
                            res = parse(deserializeE2E(args, serverE2E_PublicKey, privateKey));
                        } else res = args;

                        lastEmit(...res || []);
                    }] : []
                );

                resolve((promise && p) ? uglify ? parse(deserializeE2E(p, serverE2E_PublicKey, privateKey))[0] : p[0] : undefined);
            } catch (e) {
                reject(e);
            }
        });

        const init = async () => {
            if (hasCancelled) return;
            const mtoken = disableAuth ? undefined : Scoped.AuthJWTToken[projectUrl];
            const [reqBuilder, [privateKey]] = uglify ? serializeE2E({ accessKey, a_extras: authHandshake }, mtoken, serverE2E_PublicKey) : [null, []];

            socket = io(`ws://${projectUrl.split('://')[1]}`, {
                auth: uglify ? {
                    ugly: true,
                    e2e: reqBuilder
                } : {
                    ...mtoken ? { mtoken } : {},
                    a_extras: authHandshake,
                    accessKey
                }
            });
            clientPrivateKey = privateKey;

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
                const ref = ++socketListenerIte,
                    listener = listenerCallback(callback);

                socketListenerList.push([ref, 'on', route, listener]);
                if (socket) socket.on(route, listener);

                return () => {
                    if (socket) socket.off(route, listener);
                    socketListenerList = socketListenerList.filter(([id]) => id !== ref);
                }
            },
            once: async (route, callback) => {
                if (restrictedRoute.includes(route))
                    throw `${route} is a restricted socket path, avoid using any of ${restrictedRoute}`;
                const ref = ++socketListenerIte,
                    listener = listenerCallback(callback);

                socketListenerList.push([ref, 'once', route, listener]);
                if (socket) socket.once(route, listener);

                return () => {
                    if (socket) socket.off(route, listener);
                    socketListenerList = socketListenerList.filter(([id]) => id !== ref);
                }
            },
            destroy: () => {
                hasCancelled = true;
                tokenListener?.();
                if (socket) socket.close();
                socketListenerList = [];
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
        if (typeof v !== 'string' || !Regexs.LINK().test(v.trim()))
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
    enableE2E_Encryption: (v) => {
        if (typeof v !== 'boolean')
            throw `Invalid value supplied to enableE2E_Encryption, value must be a boolean`;
    },
    serverE2E_PublicKey: (v) => {
        if (typeof v !== 'string' || !v.trim())
            throw `Invalid value supplied to serverETE_PublicKey, value must be string and greater than one`;
    }
};

const validateMTConfig = (config, that) => {
    if (typeof config !== 'object') throw `${that.constructor.name} config is not an object`;
    const h = Object.keys(config);

    for (let i = 0; i < h.length; i++) {
        const k = h[i];

        if (!validator[k]) throw `Unexpected property named ${k}`;
        validator[k](config[k]);
    }

    if (config.enableE2E_Encryption && !config.serverE2E_PublicKey)
        throw '"serverE2E_PublicKey" is missing, enabling end-to-end encryption requires a public encryption key from the server';
    if (!config['projectUrl']) throw `projectUrl is a required property in ${that.constructor.name}() constructor`;
    if (!config['accessKey']) throw `accessKey is a required property in ${that.constructor.name}() constructor`;
}

export {
    TIMESTAMP,
    DOCUMENT_EXTRACTION,
    FIND_GEO_JSON,
    GEO_JSON
};

export default RNMT;