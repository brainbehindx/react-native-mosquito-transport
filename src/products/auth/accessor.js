import { doSignOut } from ".";
import EngineApi from "../../helpers/engine_api";
import { AuthTokenListener, TokenRefreshListener } from "../../helpers/listeners";
import { decodeBinary, deserializeE2E, listenReachableServer } from "../../helpers/peripherals";
import { awaitStore, buildFetchInterface, buildFetchResult, getPrefferTime, updateCacheStore } from "../../helpers/utils";
import { CacheStore, Scoped } from "../../helpers/variables";
import { simplifyError } from "simplify-error";

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
    updateCacheStore(0);

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
    await awaitStore();
    const { token } = CacheStore.AuthStore[projectUrl] || {};
    const tokenInfo = token && parseToken(token);

    clearInterval(Scoped.TokenRefreshTimer[projectUrl]);

    if (token) {
        const expireOn = (tokenInfo.exp * 1000) - 60000;
        const hasExpire = getPrefferTime() >= expireOn;
        const rizz = () => refreshToken(config, ++Scoped.LastTokenRefreshRef[projectUrl], maxRetries, maxRetries, forceRefresh);

        if (hasExpire || forceRefresh) {
            TokenRefreshListener.dispatch(projectUrl);
            return rizz();
        } else {
            TokenRefreshListener.dispatch(projectUrl, 'ready');
            Scoped.TokenRefreshTimer[projectUrl] = setInterval(() => {
                const countdown = expireOn - getPrefferTime();
                if (countdown > 3000) return;
                clearInterval(Scoped.TokenRefreshTimer[projectUrl]);
                TokenRefreshListener.dispatch(projectUrl);
                rizz();
            }, 3000);
        }
    } else if (forceRefresh) {
        TokenRefreshListener.dispatch(projectUrl, 'ready');
        return simplifyError('no_token_yet', 'No token is available to initiate a refresh').simpleError
    }
};

const refreshToken = (builder, processRef, remainRetries = 7, initialRetries = 7, isForceRefresh) => new Promise(async (resolve, reject) => {
    const { projectUrl, serverE2E_PublicKey, accessKey, uglify, extraHeaders } = builder;
    const lostProcess = simplifyError('process_lost', 'The token refresh process has been lost and replaced with another one');

    try {
        const { token, refreshToken: r_token } = CacheStore.AuthStore[projectUrl];

        const [reqBuilder, [privateKey]] = await buildFetchInterface({
            body: { token, r_token },
            accessKey,
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
            triggerAuthToken(projectUrl, !Scoped.InitiatedForcedToken[projectUrl] && isForceRefresh);
            if (isForceRefresh) Scoped.InitiatedForcedToken[projectUrl] = true;
            updateCacheStore();
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
                    refreshToken(builder, processRef, remainRetries - 1, initialRetries, isForceRefresh).then(resolve, reject);
                }
            }, projectUrl);
        }
    }
});