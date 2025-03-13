import cloneDeep from "lodash/cloneDeep";
import { doSignOut, revokeAuthIntance } from ".";
import EngineApi from "../../helpers/engine_api";
import { AuthTokenListener, TokenRefreshListener } from "../../helpers/listeners";
import { decodeBinary, deserializeE2E, listenReachableServer } from "../../helpers/peripherals";
import { awaitStore, buildFetchInterface, buildFetchResult, getPrefferTime, updateCacheStore } from "../../helpers/utils";
import { CacheStore, Scoped } from "../../helpers/variables";
import { simplifyError } from "simplify-error";
import { Validator } from "guard-object";

export const listenToken = (callback, projectUrl) =>
    AuthTokenListener.listenTo(projectUrl, (t, n) => {
        if (t === undefined) return;
        callback?.(t || null, n);
    }, true);

export const injectFreshToken = async (config, { token, refreshToken }) => {
    const { projectUrl } = config;

    await awaitStore();
    CacheStore.AuthStore[projectUrl] = { token, refreshToken };
    Scoped.AuthJWTToken[projectUrl] = token;
    const isEmulated = projectUrl in CacheStore.EmulatedAuth;
    if (isEmulated) delete CacheStore.EmulatedAuth[projectUrl];

    updateCacheStore(0, ['AuthStore', isEmulated ? 'EmulatedAuth' : ''].filter(v => v));

    triggerAuthToken(projectUrl);
    initTokenRefresher(config);
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
    const thisAuthStore = cloneDeep(CacheStore.AuthStore[projectUrl]);
    revokeAuthIntance(config, thisAuthStore);

    CacheStore.AuthStore[projectUrl] = cloneDeep(CacheStore.AuthStore[emulatedURL]);
    Scoped.AuthJWTToken[projectUrl] = token;
    CacheStore.EmulatedAuth[projectUrl] = emulatedURL;

    updateCacheStore(0, ['AuthStore', 'EmulatedAuth']);
    triggerAuthToken(projectUrl);
    initTokenRefresher(config);
};

export const parseToken = (token) => JSON.parse(decodeBinary(token.split('.')[1]));

export const triggerAuthToken = async (projectUrl, isInit) => {
    await awaitStore();
    AuthTokenListener.dispatch(projectUrl, CacheStore.AuthStore[projectUrl]?.token || null, isInit);
};

export const awaitRefreshToken = (projectUrl) => new Promise(resolve => {
    const l = TokenRefreshListener.listenTo(projectUrl, v => {
        if (v === 'ready') {
            l();
            resolve();
        }
    }, true);
});

export const listenTokenReady = (callback, projectUrl) => TokenRefreshListener.listenTo(projectUrl, callback, true);

export const initTokenRefresher = async (config, forceRefresh) => {
    const { projectUrl, maxRetries } = config;
    if (!Scoped.IsStoreReady) await awaitStore();
    const { token } = CacheStore.AuthStore[projectUrl] || {};
    const emulatedURL = CacheStore.EmulatedAuth[projectUrl];
    const tokenInfo = token && parseToken(token);

    clearInterval(Scoped.TokenRefreshTimer[projectUrl]);
    if (emulatedURL) return;

    const notifyAuthReady = (value) => {
        TokenRefreshListener.dispatch(projectUrl, value);
        getEmulatedLinks(projectUrl).forEach(v => {
            TokenRefreshListener.dispatch(v, value);
        });
    }

    if (token) {
        const expireOn = (tokenInfo.exp * 1000) - 60000;
        const hasExpire = getPrefferTime() >= expireOn;
        const rizz = () => refreshToken(config, ++Scoped.LastTokenRefreshRef[projectUrl], maxRetries, forceRefresh);

        if (hasExpire || forceRefresh) {
            notifyAuthReady();
            return rizz();
        } else {
            notifyAuthReady('ready');
            Scoped.TokenRefreshTimer[projectUrl] = setInterval(() => {
                const countdown = expireOn - getPrefferTime();
                if (countdown > 3000) return;
                clearInterval(Scoped.TokenRefreshTimer[projectUrl]);
                notifyAuthReady();
                rizz();
            }, 3000);
        }
    } else {
        notifyAuthReady('ready');
        if (forceRefresh) {
            return simplifyError('no_token_yet', 'No token is available to initiate a refresh').simpleError;
        }
    }
};

export const getEmulatedLinks = (projectUrl) => Object.entries(CacheStore.EmulatedAuth)
    .filter(([_, v]) => v === projectUrl)
    .map(v => v[0]);

const refreshToken = (builder, processRef, remainRetries = 1, isForceRefresh) => new Promise(async (resolve, reject) => {
    const { projectUrl, serverE2E_PublicKey, uglify, extraHeaders } = builder;
    const lostProcess = simplifyError('process_lost', 'The token refresh process has been lost and replaced with another one');

    try {
        const { token, refreshToken: r_token } = CacheStore.AuthStore[projectUrl];

        const [reqBuilder, [privateKey]] = await buildFetchInterface({
            body: { token, r_token },
            uglify,
            serverE2E_PublicKey,
            extraHeaders
        });

        let data;

        try {
            data = await buildFetchResult(await fetch(EngineApi._refreshAuthToken(projectUrl, uglify), reqBuilder), uglify);
        } finally {
            if (processRef !== Scoped.LastTokenRefreshRef[projectUrl]) {
                reject(lostProcess.simpleError);
                return;
            }
        }

        const f = uglify ? await deserializeE2E(data, serverE2E_PublicKey, privateKey) : data;

        if (CacheStore.AuthStore[projectUrl]) {
            CacheStore.AuthStore[projectUrl].token = f.result.token;
            Scoped.AuthJWTToken[projectUrl] = f.result.token;

            resolve(f.result.token);
            const isInit = !Scoped.InitiatedForcedToken[projectUrl] && isForceRefresh;

            triggerAuthToken(projectUrl, isInit);
            if (isForceRefresh) Scoped.InitiatedForcedToken[projectUrl] = true;

            getEmulatedLinks(projectUrl).forEach(v => {
                CacheStore.AuthStore[v] = cloneDeep(CacheStore.AuthStore[projectUrl]);
                Scoped.AuthJWTToken[v] = f.result.token;

                triggerAuthToken(v, isInit);
                if (isForceRefresh) Scoped.InitiatedForcedToken[v] = true;
            });
            updateCacheStore(0, ['AuthStore']);
            initTokenRefresher(builder);
        } else reject(lostProcess.simpleError);
    } catch (e) {
        if (e.simpleError) {
            console.error(`refreshToken error: ${e.simpleError?.message}`);
            doSignOut({ ...builder });
            reject(e.simpleError);
        } else if (remainRetries <= 0) {
            reject(
                processRef === Scoped.LastTokenRefreshRef[projectUrl] ?
                    lostProcess.simpleError :
                    simplifyError('retry_limit_reached', 'The retry limit has been reach and execution prematurely stopped').simpleError
            );
            console.error(`refreshToken retry limit exceeded`);
        } else {
            const l = listenReachableServer(c => {
                if (processRef !== Scoped.LastTokenRefreshRef[projectUrl]) {
                    reject(lostProcess.simpleError);
                    l();
                } else if (c) {
                    l();
                    refreshToken(builder, processRef, remainRetries - 1, isForceRefresh).then(resolve, reject);
                }
            }, projectUrl);
        }
    }
});