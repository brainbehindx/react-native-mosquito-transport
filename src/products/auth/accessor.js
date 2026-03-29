import { doSignOut, revokeAuthIntance } from "./index.js";
import EngineApi from "../../helpers/engine_api";
import { AuthTokenListener, TokenRefreshListener } from "../../helpers/listeners";
import { decodeBinary, deserializeE2E } from "../../helpers/peripherals";
import { awaitReachableServer, awaitStore, buildFetchInterface, buildFetchResult, updateCacheStore } from "../../helpers/utils";
import { CacheStore, Scoped } from "../../helpers/variables";
import { simplifyError } from "simplify-error";
import { Validator } from "guard-object";
import { basicClone } from "../../helpers/basic_clone";
import NativeMosquitoTransport from "../../NativeMosquitoTransport.js";

export const listenToken = (callback, projectUrl) =>
    AuthTokenListener.listenToPersist(projectUrl, (t, n) => {
        if (t === undefined) return;
        callback?.(t || null, n);
    });

export const injectFreshToken = async (config, { token, refreshToken }) => {
    const { projectUrl } = config;

    CacheStore.AuthStore[projectUrl] = { token, refreshToken };
    Scoped.AuthJWTToken[projectUrl] = token;
    const isEmulated = projectUrl in CacheStore.EmulatedAuth;
    if (isEmulated) delete CacheStore.EmulatedAuth[projectUrl];
    await updateTokenTimestamp(projectUrl, token);

    updateCacheStore(['AuthStore', isEmulated ? 'EmulatedAuth' : ''].filter(v => v));

    triggerAuthToken(projectUrl);
    initTokenRefresher({ config });
};

export const injectEmulatedAuth = async (config, emulatedURL) => {
    if (!Scoped.IsStoreReady) await awaitStore();
    if (typeof emulatedURL !== 'string' || (!Validator.HTTPS(emulatedURL) && !Validator.HTTP(emulatedURL)))
        throw `Expected "projectUrl" to be valid https or http link but got "${emulatedURL}"`;

    const { projectUrl } = config;
    const { token } = CacheStore.AuthStore[emulatedURL] || {};
    const depended = Object.entries(CacheStore.EmulatedAuth).find(([_, v]) => projectUrl === v);

    if (emulatedURL === projectUrl) throw `auth instance for ${emulatedURL} cannot emulate itself`;
    if (depended) throw `Chain Emulation Error: this auth instance (${projectUrl}) cannot be emulated as other auth instance (${depended[0]}) is already emulating it`;
    const thisAuthStore = basicClone(CacheStore.AuthStore[projectUrl]);
    revokeAuthIntance(config, thisAuthStore);

    CacheStore.AuthStore[projectUrl] = basicClone(CacheStore.AuthStore[emulatedURL]);
    Scoped.AuthJWTToken[projectUrl] = token;
    CacheStore.EmulatedAuth[projectUrl] = emulatedURL;

    updateCacheStore(['AuthStore', 'EmulatedAuth']);
    triggerAuthToken(projectUrl);
    initTokenRefresher({ config });
};

export const parseToken = (token) => JSON.parse(decodeBinary(token.split('.')[1]));

export const triggerAuthToken = async (projectUrl, isInit) => {
    if (!Scoped.IsStoreReady) await awaitStore();
    AuthTokenListener.dispatchPersist(projectUrl, CacheStore.AuthStore[projectUrl]?.token || null, isInit);
};

export const awaitRefreshToken = (projectUrl) =>
    new Promise(async resolve => {
        try {
            if (await initTokenRefresher({ justCheck: true, config: Scoped.InitializedProject[projectUrl] })) {
                resolve();
            } else throw null;
        } catch (_) {
            const l = TokenRefreshListener.listenToPersist(projectUrl, v => {
                if (v) {
                    l();
                    resolve();
                }
            });
        }
    });

export const listenTokenReady = (callback, projectUrl) => TokenRefreshListener.listenToPersist(projectUrl, callback);

export const initTokenRefresher = async ({ config, forceRefresh, justCheck }) => {
    const { projectUrl, maxRetries } = config;
    if (!Scoped.IsStoreReady) await awaitStore();
    const { token } = CacheStore.AuthStore[projectUrl] || {};
    const emulatedURL = CacheStore.EmulatedAuth[projectUrl];

    if (!justCheck) clearInterval(Scoped.TokenRefreshTimer[projectUrl]);
    if (emulatedURL) return;

    const notifyAuthReady = (value) => {
        if (justCheck) return;
        TokenRefreshListener.dispatchPersist(projectUrl, value);
        getEmulatedLinks(projectUrl).forEach(v => {
            TokenRefreshListener.dispatchPersist(v, value);
        });
    }

    if (token) {
        const rizz = () => {
            let runningProcess = Scoped.TokenRefreshProcess[projectUrl];
            if (!runningProcess) {
                runningProcess = refreshToken(config, maxRetries, forceRefresh);
                Scoped.TokenRefreshProcess[projectUrl] = runningProcess;

                Scoped.TokenRefreshProcess[projectUrl].finally(() => {
                    delete Scoped.TokenRefreshProcess[projectUrl];
                });
            }
            return runningProcess;
        }

        if (await hasTokenExpire(projectUrl) || forceRefresh) {
            notifyAuthReady();
            return rizz();
        } else {
            notifyAuthReady(true);
            if (justCheck) {
                return true;
            } else {
                let lastIte = 0;
                clearInterval(Scoped.TokenRefreshTimer[projectUrl]);
                Scoped.TokenRefreshTimer[projectUrl] = setInterval(async () => {
                    const iteRef = ++lastIte;
                    if (!(await hasTokenExpire(projectUrl)) || iteRef !== lastIte) return;
                    clearInterval(Scoped.TokenRefreshTimer[projectUrl]);
                    notifyAuthReady();
                    rizz();
                }, 7000);
            }
        }
    } else {
        notifyAuthReady(true);
        if (justCheck) return true;
    }
};

const hasTokenExpire = async (projectUrl) => {
    const timestamp = Scoped.TokenTimestamping[projectUrl];
    if (!timestamp) return true;
    const uptime = await NativeMosquitoTransport.getSystemUptime();

    return timestamp.ttl <= (uptime - timestamp.uptime);
}

const updateTokenTimestamp = async (projectUrl, token) => {
    const { exp, iat } = parseToken(token);
    Scoped.TokenTimestamping[projectUrl] = {
        ttl: ((exp * 1000) - (iat * 1000)) - 60_000,
        uptime: await NativeMosquitoTransport.getSystemUptime()
    };
}

export const getEmulatedLinks = (projectUrl) =>
    Object.entries(CacheStore.EmulatedAuth)
        .filter(([_, v]) => v === projectUrl)
        .map(v => v[0]);

const refreshToken = (builder, remainRetries = 1, isForceRefresh) =>
    new Promise(async (resolve, reject) => {
        const { projectUrl, serverE2E_PublicKey, uglify, extraHeaders } = builder;

        try {
            const { token, refreshToken: r_token } = CacheStore.AuthStore[projectUrl];

            const [reqBuilder, [privateKey]] = await buildFetchInterface({
                body: { token, r_token },
                uglify,
                serverE2E_PublicKey,
                extraHeaders
            });

            const data = await buildFetchResult(await fetch(EngineApi._refreshAuthToken(projectUrl, uglify), reqBuilder), uglify);

            const f = uglify ? await deserializeE2E(data, serverE2E_PublicKey, privateKey) : data;

            if (!CacheStore.AuthStore[projectUrl]) {
                reject(simplifyError('token_not_mounted', 'No refresh token was mounted or has been recently removed').simpleError);
                return;
            }

            CacheStore.AuthStore[projectUrl].token = f.result.token;
            Scoped.AuthJWTToken[projectUrl] = f.result.token;
            await updateTokenTimestamp(projectUrl, f.result.token);

            resolve(f.result.token);
            const isInit = !Scoped.InitiatedForcedToken[projectUrl];

            triggerAuthToken(projectUrl, isInit);
            if (isInit) Scoped.InitiatedForcedToken[projectUrl] = true;

            getEmulatedLinks(projectUrl).forEach(v => {
                CacheStore.AuthStore[v] = basicClone(CacheStore.AuthStore[projectUrl]);
                Scoped.AuthJWTToken[v] = f.result.token;

                triggerAuthToken(v, isInit);
                if (isForceRefresh) Scoped.InitiatedForcedToken[v] = true;
            });
            updateCacheStore(['AuthStore']);
            initTokenRefresher({ config: builder });
        } catch (e) {
            if (e.simpleError) {
                console.error(`refreshToken error: ${e.simpleError?.message}`);
                doSignOut({ ...builder });
                reject(e.simpleError);
            } else if (remainRetries <= 0) {
                reject(
                    simplifyError('retry_limit_reached', 'The retry limit has been reach and execution prematurely stopped').simpleError
                );
                console.error(`refreshToken retry limit exceeded err:`, e);
            } else {
                awaitReachableServer(projectUrl).then(() => {
                    refreshToken(builder, remainRetries - 1, isForceRefresh).then(resolve, reject);
                });
            }
        }
    });