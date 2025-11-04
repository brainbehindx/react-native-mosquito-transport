import 'react-native-get-random-values';
import { deserializeE2E, listenReachableServer, serializeE2E } from "./helpers/peripherals";
import { awaitStore, releaseCacheStore } from "./helpers/utils";
import { CacheStore, Scoped } from "./helpers/variables";
import { MTCollection, batchWrite, onCollectionConnect, trySendPendingWrite } from "./products/database";
import { MTStorage } from "./products/storage";
import { ServerReachableListener, TokenRefreshListener } from "./helpers/listeners";
import { initTokenRefresher, listenToken, listenTokenReady, triggerAuthToken } from "./products/auth/accessor";
import { TIMESTAMP, DOCUMENT_EXTRACTION, FIND_GEO_JSON, GEO_JSON, TIMESTAMP_OFFSET } from "./products/database/types";
import { mfetch } from "./products/http_callable";
import { io } from "socket.io-client";
import { AUTH_PROVIDER_ID } from "./helpers/values";
import EngineApi from './helpers/engine_api';
import { Validator } from 'guard-object';
import { Buffer } from 'buffer';
import MTAuth, { purgePendingToken } from './products/auth';
import { BSON } from "./vendor/bson";
import { basicClone } from './helpers/basic_clone';

const {
    _listenCollection,
    _listenDocument,
    _startDisconnectWriteTask,
    _cancelDisconnectWriteTask,
    _listenUserVerification,
    _areYouOk
} = EngineApi;

// https://socket.io/docs/v3/emit-cheatsheet/#reserved-events
const reservedEventName = [
    'connect',
    'connect_error',
    'disconnect',
    'disconnecting',
    'newListener',
    'removeListener'
];

class RNMT {
    constructor(config) {
        validateMTConfig(config, this);
        this.config = {
            ...config,
            dbName: config.dbName || '',
            dbUrl: config.dbUrl || '',
            serverE2E_PublicKey: config.serverE2E_PublicKey && new Uint8Array(Buffer.from(config.serverE2E_PublicKey, 'base64')),
            castBSON: config.castBSON === undefined || config.castBSON,
            maxRetries: config.maxRetries || 3,
            uglify: config.enableE2E_Encryption
        };
        const { projectUrl, extraHeaders } = this.config;

        this.config.secureUrl = projectUrl.startsWith('https');
        this.config.baseUrl = projectUrl.split('://')[1];
        this.config.wsPrefix = this.config.secureUrl ? 'wss' : 'ws';

        if (!Scoped.ReleaseCacheData)
            throw `initializeCache must be called before creating any ${this.constructor.name} instance`;

        if (!Scoped.InitializedProject[projectUrl]) {
            Scoped.InitializedProject[projectUrl] = basicClone(this.config);
            Scoped.LastTokenRefreshRef[projectUrl] = 0;
            triggerAuthToken(projectUrl);
            initTokenRefresher({ ...this.config }, true);

            let isConnected, recentToken;

            const socket = io(`${this.config.wsPrefix}://${this.config.baseUrl}`, {
                transports: ['websocket', 'polling', 'flashsocket'],
                extraHeaders,
                auth: {
                    _m_internal: true,
                    _from_base: true
                }
            });
            let connectionIte = 0;
            const onConnect = () => {
                ++connectionIte;
                isConnected = true;
                Scoped.IS_CONNECTED[projectUrl] = true;
                if (recentToken) updateMountedToken();
                ServerReachableListener.dispatchPersist(projectUrl, true);
                awaitStore().then(() => {
                    if (isConnected) trySendPendingWrite(projectUrl);
                });
            };
            const onDisconnect = () => {
                ++connectionIte;
                isConnected = false;
                Scoped.IS_CONNECTED[projectUrl] = false;
                ServerReachableListener.dispatchPersist(projectUrl, false);
            }

            const manualCheckConnection = () => {
                const ref = ++connectionIte;
                fetch(_areYouOk(projectUrl), { credentials: 'omit' }).then(async r => {
                    if ((await r.json()).status === 'yes') {
                        if (ref === connectionIte) onConnect();
                    } else throw null;
                }).catch(() => {
                    if (ref === connectionIte) onDisconnect();
                });
            }
            manualCheckConnection();

            socket.on('_signal_signout', () => {
                this.auth().signOut();
            });

            socket.on('connect', onConnect);
            socket.on('disconnect', () => {
                manualCheckConnection();
            });

            const updateMountedToken = () => {
                socket.emit('_update_mounted_user', recentToken || null);
            };

            listenToken(token => {
                recentToken = token;
                if (isConnected) updateMountedToken();
            }, projectUrl);

            TokenRefreshListener.listenTo(projectUrl, v => {
                Scoped.IS_TOKEN_READY[projectUrl] = v;
            });
        }
    }

    static initializeCache(prop) {
        if (Scoped.ReleaseCacheData) throw `calling ${this.name}() multiple times is prohibited`;
        validateReleaseCacheProp({ ...prop });
        Scoped.ReleaseCacheData = { ...prop };
        releaseCacheStore({ ...prop });
        // purge residue tokens
        awaitStore().then(() => {
            Object.keys(CacheStore.PendingAuthPurge).forEach(k => {
                purgePendingToken(k);
            });
        });
    }

    getDatabase = (dbName, dbUrl) => {
        if (dbName) ConfigValidator.dbName(dbName);
        if (dbUrl) ConfigValidator.dbUrl(dbUrl);

        return {
            collection: (path) => new MTCollection({
                ...this.config,
                path,
                dbName: dbName || '',
                dbUrl: dbUrl || ''
            })
        };
    }

    collection = (path) => new MTCollection({ ...this.config, path });

    onConnect = () => onCollectionConnect({ ...this.config });

    batchWrite = (map, configx) => batchWrite({ ...this.config }, map, configx);
    auth = () => new MTAuth({ ...this.config });
    storage = () => new MTStorage({ ...this.config });
    fetchHttp = (endpoint, init, config) => mfetch(endpoint, init, { ...this.config, method: config });
    listenReachableServer = (callback) => listenReachableServer(callback, this.config.projectUrl);

    getSocket = (configOpts) => {
        const { disableAuth, authHandshake } = configOpts || {};
        const { projectUrl, uglify, serverE2E_PublicKey, wsPrefix, extraHeaders } = this.config;

        const restrictedRoute = [
            _listenCollection,
            _listenDocument,
            _startDisconnectWriteTask,
            _cancelDisconnectWriteTask,
            _listenUserVerification
        ].map(v => [v(), v(true)]).flat();

        const makeSocketCallback = () =>
            new Promise(resolve => {
                socketReadyCallback = resolve;
            });

        let socketReadyCallback,
            socketReadyPromise = makeSocketCallback(),
            socketListenerList = [],
            socketListenerIte = 0;

        /**
         * @type {import('socket.io-client').Socket}
         */
        let socket;
        let hasCancelled,
            tokenListener,
            clientPrivateKey;

        const listenerCallback = (route, callback) => async function () {
            if (reservedEventName.includes(route)) {
                callback?.(...[...arguments]);
                return;
            }

            const [[args, not_encrypted], emitable] = [...arguments];
            let res;

            if (uglify) {
                res = await deserializeE2E(args, serverE2E_PublicKey, clientPrivateKey);
            } else res = args;
            const sortedArgs = discloseSocketArguments([res, not_encrypted]);

            callback?.(...sortedArgs, ...typeof emitable === 'function' ? [async function () {
                const [args, not_encrypted] = encloseSocketArguments([...arguments]);
                let res;

                if (uglify) {
                    res = (await serializeE2E(args, undefined, serverE2E_PublicKey))[0];
                } else res = args;

                emitable([res, not_encrypted]);
            }] : []);
        };

        const emit = ({ timeout, promise, emittion: emittionx }) => new Promise(async (resolve, reject) => {
            const [route, ...emittion] = emittionx;

            if (typeof route !== 'string')
                throw `expected ${promise ? 'emitWithAck' : 'emit'} first argument to be a string type`;

            if (restrictedRoute.includes(route))
                throw `${route} is a restricted socket path, avoid using any of ${restrictedRoute}`;

            let hasResolved, stime = Date.now();

            const timer = timeout ? setTimeout(() => {
                hasResolved = true;
                reject(new Error('emittion timeout'));
            }, timeout) : undefined;

            await socketReadyPromise;
            if (hasResolved) return;
            clearTimeout(timer);

            try {
                const thisSocket = timeout ? socket.timeout(Math.max(timeout - (Date.now() - stime), 0)) : socket;

                const lastEmit = emittion.slice(-1)[0];
                const hasEmitable = typeof lastEmit === 'function';
                const [mit, not_encrypted] = encloseSocketArguments(hasEmitable ? emittion.slice(0, -1) : emittion);

                const [reqBuilder, [privateKey]] = uglify ? await serializeE2E(mit, undefined, serverE2E_PublicKey) : [undefined, []];

                if (hasEmitable && promise)
                    throw 'emitWithAck cannot have function in it argument';

                const result = await thisSocket[promise ? 'emitWithAck' : 'emit'](route,
                    [uglify ? reqBuilder : mit, not_encrypted],
                    ...hasEmitable ? [async function () {
                        const [[args, not_encrypted]] = [...arguments];
                        let res;

                        if (uglify) {
                            res = await deserializeE2E(args, serverE2E_PublicKey, privateKey);
                        } else res = args;

                        lastEmit(...discloseSocketArguments([res, not_encrypted]));
                    }] : []
                );
                if (promise && result) {
                    resolve(discloseSocketArguments([uglify ? await deserializeE2E(result[0], serverE2E_PublicKey, privateKey) : result[0], result[1]])[0]);
                } else resolve();
            } catch (e) {
                reject(e);
            }
        });

        const init = async () => {
            if (hasCancelled) return;
            const mtoken = disableAuth ? undefined : Scoped.AuthJWTToken[projectUrl];
            const [reqBuilder, [privateKey]] = uglify ? await serializeE2E({ a_extras: authHandshake }, mtoken, serverE2E_PublicKey) : [null, []];

            socket = io(`${wsPrefix}://${projectUrl.split('://')[1]}`, {
                transports: ['websocket', 'polling', 'flashsocket'],
                extraHeaders,
                auth: uglify ? {
                    ugly: true,
                    e2e: reqBuilder.toString('base64')
                } : {
                    ...mtoken ? { mtoken } : {},
                    a_extras: authHandshake
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

        const resultant = {
            timeout: (timeout) => {
                if (timeout !== undefined && !Validator.POSITIVE_INTEGER(timeout))
                    throw `expected a positive integer for timeout but got ${timeout}`;

                return {
                    emitWithAck: function () {
                        return emit({
                            timeout,
                            promise: true,
                            emittion: [...arguments]
                        });
                    }
                };
            },
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
                    listener = listenerCallback(route, callback);

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
                    listener = listenerCallback(route, callback);

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
        };

        Object.defineProperty(resultant, 'disconnected', {
            get() {
                return socket.disconnected;
            },
            enumerable: true,
            configurable: false
        });

        return resultant;
    }
};

class DoNotEncrypt {
    constructor(value) {
        this.value = value;
    }
};

const encloseSocketArguments = (args) => {
    const [encrypted, unencrypted] = [{}, {}];

    args.forEach((v, i) => {
        if (v instanceof DoNotEncrypt) {
            unencrypted[i] = v.value;
        } else encrypted[i] = v;
    });
    return [encrypted, unencrypted];
}

const discloseSocketArguments = (args = []) => {
    return args.map((obj, i) => Object.entries(obj).map(v => i ? [v[0], new DoNotEncrypt(v[1])] : v)).flat()
        .sort((a, b) => (a[0] * 1) - (b[0] * 1)).map((v, i) => {
            if (v[0] * 1 !== i) throw 'corrupted socket arguments';
            return v[1];
        });
}

const validateReleaseCacheProp = (prop) => {
    Object.entries(prop).forEach(([k, v]) => {
        if (k === 'io') {
            Object.entries(v).forEach(([k, v]) => {
                if (k === 'input' || k === 'output') {
                    if (typeof v !== 'function')
                        throw `Invalid value supplied to "io.${k}", expected a function but got "${v}"`;
                } else throw `Unexpected property named "io.${k}"`;
            });
            if (!v?.input || !v?.output) throw '"input" and "output" are required when "io" is provided';
        } else if (k === 'promoteCache') {
            if (typeof v !== 'boolean') throw 'promoteCache should be a boolean';
        } else if (['maxLocalDatabaseSize', 'maxLocalFetchHttpSize'].includes(k)) {
            if (!Validator.POSITIVE_INTEGER(v) || v <= 0)
                throw `Invalid value supplied to ${k}, value must be a positive integer greater than zero`;
        } else throw `Unexpected property named ${k}`;
    });
}

const ConfigValidator = {
    dbName: (v) => {
        if (typeof v !== 'string' || !v.trim())
            throw `Invalid value supplied to dbName, value must be a non-empty string`;
    },
    dbUrl: (v) => {
        if (typeof v !== 'string' || !v.trim())
            throw `Invalid value supplied to dbUrl, value must be a non-empty string`;
    },
    projectUrl: (v) => {
        if (typeof v !== 'string' || (!Validator.HTTPS(v) && !Validator.HTTP(v)))
            throw `Expected "projectUrl" to be valid https or http link but got "${v}"`;
        if (v.endsWith('/')) throw '"projectUrl" must not end with a trailing slash "/"';
    },
    disableCache: (v) => {
        if (typeof v !== 'boolean')
            throw `Invalid value supplied to disableCache, value must be a boolean`;
    },
    maxRetries: (v) => {
        if (v <= 0 || !Validator.POSITIVE_INTEGER(v))
            throw `Invalid value supplied to maxRetries, value must be positive integer greater than zero`;
    },
    enableE2E_Encryption: (v) => {
        if (typeof v !== 'boolean')
            throw `Invalid value supplied to enableE2E_Encryption, value must be a boolean`;
    },
    castBSON: v => {
        if (typeof v !== 'boolean')
            throw `Invalid value supplied to castBSON, value must be a boolean`;
    },
    borrowToken: v => {
        if (typeof v !== 'string' || (!Validator.HTTPS(v) && !Validator.HTTP(v)))
            throw `Expected "borrowToken" to be valid https or http link but got "${v}"`;
    },
    serverE2E_PublicKey: (v) => {
        if (typeof v !== 'string' || !v.trim())
            throw `Invalid value supplied to serverETE_PublicKey, value must be a non-empty string`;
    },
    extraHeaders: v => {
        if (!Validator.OBJECT(v)) throw '"extraHeaders" must be an object';
        const reservedHeaders = ['mtoken', 'mosquito-token', 'init-content-type', 'content-type', 'uglified', 'entity-encoded'];

        Object.entries(v).forEach(([k, v]) => {
            if (typeof v !== 'string') throw `expected a string at extraHeaders.${k} but got "${v}"`;
            if (reservedHeaders.includes(v.toLowerCase()))
                throw `extraHeaders must not include any reserved props which are: ${reservedHeaders}`;
        });
    }
};

const validateMTConfig = (config, that) => {
    if (!Validator.OBJECT(config))
        throw `${that.constructor.name} config is not an object`;

    for (const [k, v] of Object.entries(config)) {
        if (!ConfigValidator[k]) throw `Unexpected property named ${k}`;
        ConfigValidator[k](v);
    }

    if (config.enableE2E_Encryption && !config.serverE2E_PublicKey)
        throw '"serverE2E_PublicKey" is missing, enabling end-to-end encryption requires a public encryption key from the server';
    if (!config.projectUrl) throw `projectUrl is a required property in ${that.constructor.name}() constructor`;
}

export {
    DoNotEncrypt,
    TIMESTAMP,
    TIMESTAMP_OFFSET,
    DOCUMENT_EXTRACTION,
    FIND_GEO_JSON,
    GEO_JSON,
    AUTH_PROVIDER_ID,
    BSON
};

export default RNMT;