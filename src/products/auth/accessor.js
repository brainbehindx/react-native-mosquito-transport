import { doSignOut } from ".";
import EngineApi from "../../helpers/EngineApi";
import { AuthListener, AuthTokenListener, TokenRefreshListener } from "../../helpers/listeners";
import { listenReachableServer } from "../../helpers/peripherals";
import { awaitReachableServer, awaitStore, buildFetchInterface, simplifyError, updateCacheStore } from "../../helpers/utils";
import { CacheStore, Scoped } from "../../helpers/variables";

export const listenToken = (callback, projectUrl) =>
    AuthTokenListener.listenTo(projectUrl, t => {
        if (t === undefined) return;
        callback?.(t || null);
    }, true);

export const injectFreshToken = async (config, obj) => {
    const { projectUrl } = config;

    await awaitStore();
    CacheStore.AuthStore[projectUrl] = { ...obj };
    Scoped.AuthJWTToken[projectUrl] = obj.token;
    updateCacheStore();

    triggerAuth(projectUrl);
    triggerAuthToken(projectUrl);
    initTokenRefresher(config);
}

export const triggerAuth = async (projectUrl) => {
    await awaitStore();
    const l = CacheStore.AuthStore[projectUrl]?.tokenData;
    AuthListener.dispatch(projectUrl, l ? { ...l } : null);
}

export const triggerAuthToken = async (projectUrl) => {
    await awaitStore();
    AuthTokenListener.dispatch(projectUrl, CacheStore.AuthStore[projectUrl]?.token || null);
}

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
    const l = CacheStore.AuthStore[projectUrl]?.tokenData;
    clearTimeout(Scoped.TokenRefreshTimer[projectUrl]);

    if (l) {
        const hasExpire = Date.now() >= l.expOn - 60000,
            rizz = () => refreshToken(config, ++Scoped.LastTokenRefreshRef[projectUrl], maxRetries, maxRetries);

        if (hasExpire || forceRefresh) {
            if (hasExpire) TokenRefreshListener.dispatch(projectUrl);
            return rizz();
        } else {
            TokenRefreshListener.dispatch(projectUrl, 'ready');
            Scoped.TokenRefreshTimer[projectUrl] = setTimeout(() => {
                TokenRefreshListener.dispatch(projectUrl);
                rizz();
            }, l.expOn - (Date.now() - 60000));
        }
    } else if (forceRefresh) {
        TokenRefreshListener.dispatch(projectUrl, 'ready');
        return simplifyError('no_token_yet', 'No token is available to initiate a refresh').simpleError
    }
}

const refreshToken = (builder, processRef, remainRetries = 7, initialRetries = 7) => new Promise(async (resolve, reject) => {
    const { projectUrl, accessKey, uglify } = builder;
    const lostProcess = simplifyError('process_lost', 'The token refresh process has been lost and replace with another one');

    try {
        const token = Scoped.AuthJWTToken[projectUrl],
            r = await (await fetch(EngineApi._refreshAuthToken(projectUrl, uglify), buildFetchInterface({
                body: { _: Scoped.AuthJWTToken[projectUrl] },
                projectUrl,
                accessKey,
                uglify
            }))).json();

        if (processRef !== Scoped.LastTokenRefreshRef[projectUrl]) throw lostProcess;
        if (r.simpleError) throw r;

        if (CacheStore.AuthStore[projectUrl]) {
            CacheStore.AuthStore[projectUrl] = { ...r.result };
            Scoped.AuthJWTToken[projectUrl] = r.result.token;
            invalidateToken(builder, token);
            resolve(r.result.token);
            triggerAuthToken(projectUrl);
            updateCacheStore();
            initTokenRefresher({ projectUrl, accessKey, maxRetries: initialRetries });
        } else throw lostProcess;
    } catch (e) {
        if (e.simpleError) {
            console.error(`refreshToken error: ${e.simpleError?.message}`);
            doSignOut({ projectUrl, accessKey });
            reject(e.simpleError);
        } else if (remainRetries <= 0) {
            console.error(`refreshToken retry exceeded, waiting for 2min before starting another retry`);
            setTimeout(() => {
                if (processRef === Scoped.LastTokenRefreshRef[projectUrl]) {
                    refreshToken(builder, processRef, initialRetries, initialRetries).then(resolve, reject);
                } else reject(lostProcess.simpleError);
            }, 120000);
        } else {
            const l = listenReachableServer(c => {
                if (c) {
                    l();
                    refreshToken(builder, processRef, remainRetries - 1, initialRetries).then(resolve, reject);
                } else if (processRef !== Scoped.LastTokenRefreshRef[projectUrl]) {
                    reject(lostProcess.simpleError);
                    l();
                }
            }, projectUrl);
        }
    }
});

export const invalidateToken = async (builder, token) => {
    try {
        const { projectUrl, accessKey, uglify } = builder;

        await awaitReachableServer(projectUrl);
        const r = await (await fetch(EngineApi._invalidateToken(projectUrl, uglify), buildFetchInterface({
            body: { _: token },
            accessKey,
            uglify,
            projectUrl
        }))).json();
        if (r.simpleError) throw r;
    } catch (e) {
        console.error('invalidateToken err: ', e);
        throw e?.simpleError || { error: 'unexpected_error', message: `Error: ${e}` };
    }
}