import { doSignOut } from ".";
import EngineApi from "../../helpers/EngineApi";
import { AuthListener, AuthTokenListener, TokenRefreshListener } from "../../helpers/listeners";
import { listenReachableServer } from "../../helpers/peripherals";
import { awaitReachableServer, awaitStore, buildFetchInterface, simplifyError, updateCacheStore } from "../../helpers/utils";
import { CacheStore, Scoped } from "../../helpers/variables";

export const listenToken = (callback, projectUrl) =>
    AuthTokenListener.startKeyListener(projectUrl, t => {
        if (t === undefined) return;
        callback?.(t || null);
    }, true);

export const injectFreshToken = async (projectUrl, obj) => {
    await awaitStore();
    CacheStore.AuthStore[projectUrl] = { ...obj };
    Scoped.AuthJWTToken[projectUrl] = obj.token;
    updateCacheStore();

    triggerAuth(projectUrl);
    triggerAuthToken(projectUrl);
}

export const triggerAuth = async (projectUrl) => {
    await awaitStore();
    const l = CacheStore.AuthStore[projectUrl]?.tokenData;
    AuthListener.triggerKeyListener(projectUrl, l ? { ...l } : null);
}

export const triggerAuthToken = async (projectUrl) => {
    await awaitStore();
    AuthTokenListener.triggerKeyListener(projectUrl, CacheStore.AuthStore[projectUrl]?.token || null);
}

export const awaitRefreshToken = (projectUrl) => new Promise(resolve => {
    const l = TokenRefreshListener.startKeyListener(projectUrl, v => {
        if (v === 'ready') {
            l();
            resolve();
        }
    }, true);
});

export const initTokenRefresher = async (config, forceRefresh) => {
    const { projectUrl, accessKey, maxRetries } = config;
    await awaitStore();
    const l = CacheStore.AuthStore[projectUrl]?.tokenData;
    clearTimeout(Scoped.TokenRefreshTimer[projectUrl]);

    if (l) {
        const hasExpire = Date.now() >= l.expOn - 60000,
            rizz = () => refreshToken(projectUrl, accessKey, ++Scoped.LastTokenRefreshRef[projectUrl], maxRetries, maxRetries);

        if (hasExpire || forceRefresh) {
            if (hasExpire) TokenRefreshListener.triggerKeyListener(projectUrl);
            return rizz();
        } else {
            TokenRefreshListener.triggerKeyListener(projectUrl, 'ready');
            Scoped.TokenRefreshTimer[projectUrl] = setTimeout(() => {
                TokenRefreshListener.triggerKeyListener(projectUrl);
                rizz();
            }, l.expOn - Date.now() - 60000);
        }
    } else if (forceRefresh) {
        TokenRefreshListener.triggerKeyListener(projectUrl, 'ready');
        return simplifyError('no_token_yet', 'No token is available to initiate a refresh').simpleError
    }
}

export const refreshToken = async (projectUrl, accessKey, processRef, remainRetries = 7, initialRetries = 7) => {
    const lostProcess = simplifyError('process_lost', 'The token refresh process has been lost and replace with another one');

    try {
        const token = Scoped.AuthJWTToken[projectUrl],
            r = await (await fetch(EngineApi._refreshAuthToken(projectUrl), buildFetchInterface({
                _: Scoped.AuthJWTToken[projectUrl]
            }, accessKey))).json();

        if (processRef !== Scoped.LastTokenRefreshRef[projectUrl]) throw lostProcess;
        if (r.simpleError) throw r;

        if (CacheStore.AuthStore[projectUrl]) {
            CacheStore.AuthStore[projectUrl] = { ...r.result };
            Scoped.AuthJWTToken[projectUrl] = r.result.token;
            triggerAuthToken(projectUrl);
            updateCacheStore();
            invalidateToken(projectUrl, accessKey, token);
            initTokenRefresher({ projectUrl, accessKey, maxRetries: initialRetries });
            return r.result.token;
        } else throw lostProcess;
    } catch (e) {
        if (e.simpleError) {
            console.error(`refreshToken error: ${e.simpleError?.message}`);
            doSignOut({ projectUrl, accessKey });
            throw e.simpleError;
        } else if (remainRetries <= 0) {
            console.error(`refreshToken retry exceeded, waiting for 2min before starting another retry`);
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    if (processRef === Scoped.LastTokenRefreshRef[projectUrl]) {
                        refreshToken(projectUrl, accessKey, processRef, initialRetries, initialRetries).then(resolve, reject);
                    } else reject(lostProcess.simpleError);
                }, 120000);
            });
        } else {
            return new Promise((resolve, reject) => {
                const l = listenReachableServer(c => {
                    if (c) {
                        l();
                        refreshToken(projectUrl, accessKey, processRef, remainRetries - 1, initialRetries).then(resolve, reject);
                    } else if (processRef !== Scoped.LastTokenRefreshRef[projectUrl]) {
                        reject(lostProcess.simpleError);
                        l();
                    }
                }, projectUrl);
            });
        }
    }
}

export const invalidateToken = async (projectUrl, accessKey, token) => {
    try {
        await awaitReachableServer(projectUrl);
        const r = await (await fetch(EngineApi._invalidateToken(projectUrl), buildFetchInterface({
            _: token
        }, accessKey))).json();
        if (r.simpleError) throw r;
    } catch (e) {
        console.error('invalidateToken err: ', e);
        throw e?.simpleError || { error: 'unexpected_error', message: `Error: ${e}` };
    }
}