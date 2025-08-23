import { io } from "socket.io-client";
import EngineApi from "../../helpers/engine_api";
import { TokenRefreshListener } from "../../helpers/listeners";
import { awaitReachableServer, awaitStore, buildFetchInterface, buildFetchResult, updateCacheStore } from "../../helpers/utils";
import { CacheStore, Scoped } from "../../helpers/variables";
import { awaitRefreshToken, getEmulatedLinks, initTokenRefresher, injectEmulatedAuth, injectFreshToken, listenToken, parseToken, triggerAuthToken } from "./accessor";
import { deserializeE2E, encodeBinary, serializeE2E } from "../../helpers/peripherals";
import { simplifyCaughtError, simplifyError } from "simplify-error";
import { basicClone } from "../../helpers/basic_clone";

const {
    _listenUserVerification,
    _signOut,
    _customSignin,
    _customSignup,
    _googleSignin,
    _areYouOk
} = EngineApi;

export default class MTAuth {
    constructor(config) {
        this.builder = { ...config };
    }

    customSignin = (email, password) => doCustomSignin(this.builder, email, password);

    customSignup = (email, password, name, metadata) => doCustomSignup(this.builder, email, password, name, metadata);

    googleSignin = (token) => doGoogleSignin(this.builder, token);

    appleSignin() {
        throw 'unsupported method call';
    }

    facebookSignin() {
        throw 'unsupported method call';
    }

    twitterSignin() {
        throw 'unsupported method call';
    }

    githubSignin() {
        throw 'unsupported method call';
    }

    listenVerifiedStatus(callback, onError) {
        const { projectUrl, serverE2E_PublicKey, uglify, baseUrl, wsPrefix } = this.builder;

        let socket,
            hasCancelled,
            lastToken = Scoped.AuthJWTToken[projectUrl] || null,
            lastInitRef = 0;

        const init = async () => {
            const processID = ++lastInitRef;
            await awaitRefreshToken(projectUrl);

            if (!Scoped.AuthJWTToken[projectUrl]) {
                onError?.(simplifyError('user_login_required', 'You must be signed-in to use this method').simpleError);
                return;
            }
            if (processID !== lastInitRef) return;
            const mtoken = Scoped.AuthJWTToken[projectUrl],
                [reqBuilder, [privateKey]] = uglify ? await serializeE2E({ mtoken }, undefined, serverE2E_PublicKey) : [null, []];

            socket = io(`${wsPrefix}://${baseUrl}`, {
                transports: ['websocket', 'polling', 'flashsocket'],
                auth: {
                    ...uglify ? { e2e: reqBuilder.toString('base64') } : { mtoken },
                    _m_internal: true,
                    _m_route: _listenUserVerification(uglify)
                }
            });

            socket.on("onVerificationChanged", async ([err, verified]) => {
                if (err) {
                    onError?.(simplifyCaughtError(err).simpleError);
                } else {
                    callback?.(uglify ? await deserializeE2E(verified, serverE2E_PublicKey, privateKey) : verified);
                }
            });
        };

        init();

        const tokenListener = listenToken(t => {
            if ((t || null) !== lastToken) {
                socket?.close?.();
                init();
            }
            lastToken = t;
        }, projectUrl);

        return () => {
            if (hasCancelled) return;
            hasCancelled = true;
            socket?.close?.();
            tokenListener?.();
        }
    }

    listenAuthToken = (callback) => listenToken(callback, this.builder.projectUrl);

    getRefreshToken = async () => {
        await awaitStore();
        return CacheStore.AuthStore[this.builder.projectUrl]?.refreshToken;
    }

    getRefreshTokenData = async () => {
        await awaitStore();
        const { refreshToken } = CacheStore.AuthStore[this.builder.projectUrl] || {};
        return refreshToken && parseToken(refreshToken);
    }

    parseToken = (token) => parseToken(token);

    getAuthToken = () => new Promise(resolve => {
        const l = listenToken(t => {
            l();
            resolve(t || null);
        }, this.builder.projectUrl);
    });

    listenAuth = (callback) => {
        let hasTrig;
        const forceChangedNode = [['entityOf'], ['passwordVerified'], ['disabled'], ['authVerified'], ['sub'], ['email']];

        return listenToken((t, initToken) => {
            const { refreshToken } = CacheStore.AuthStore[this.builder.projectUrl] || {};
            const parseData = t && parseToken(t);

            if (
                !hasTrig ||
                forceChangedNode.some(([k, v]) => parseData?.[k] !== v) ||
                initToken
            ) {
                callback(t ? {
                    ...parseData,
                    tokenManager: {
                        refreshToken,
                        accessToken: t
                    }
                } : null);
            }

            forceChangedNode.forEach(v => {
                v[1] = parseData?.[v[0]];
            });
            hasTrig = true;
        }, this.builder.projectUrl);
    }

    getAuth = () => new Promise(resolve => {
        const l = this.listenAuth(d => {
            l();
            resolve(d);
        });
    });

    signOut = () => doSignOut(this.builder);

    forceRefreshToken = () => initTokenRefresher(this.builder, true);

    emulate = async (projectUrl) => {
        await injectEmulatedAuth(this.builder, projectUrl);
    }
};

const doCustomSignin = (builder, email, password) => new Promise(async (resolve, reject) => {
    const { projectUrl, serverE2E_PublicKey, uglify, extraHeaders } = builder;

    try {
        await awaitStore();
        const thisAuthStore = basicClone(CacheStore.AuthStore[projectUrl]);

        const [reqBuilder, [privateKey]] = await buildFetchInterface({
            body: { data: `${encodeBinary(email)}.${encodeBinary(password)}` },
            serverE2E_PublicKey,
            uglify,
            extraHeaders
        });

        const data = await buildFetchResult(await fetch(_customSignin(projectUrl, uglify), reqBuilder), uglify);

        const r = uglify ? await deserializeE2E(data, serverE2E_PublicKey, privateKey) : data;

        resolve({
            user: parseToken(r.result.token),
            token: r.result.token,
            refreshToken: r.result.refreshToken
        });
        await injectFreshToken(builder, r.result);
        revokeAuthIntance(builder, thisAuthStore);
    } catch (e) {
        reject(simplifyCaughtError(e).simpleError);
    }
});

const doCustomSignup = (builder, email, password, name, metadata) => new Promise(async (resolve, reject) => {
    const { projectUrl, serverE2E_PublicKey, uglify, extraHeaders } = builder;

    try {
        await awaitStore();
        const thisAuthStore = basicClone(CacheStore.AuthStore[projectUrl]);

        const [reqBuilder, [privateKey]] = await buildFetchInterface({
            body: {
                data: `${encodeBinary(email)}.${encodeBinary(password)}.${(encodeBinary((name || '').trim()))}`,
                metadata,
            },
            serverE2E_PublicKey,
            uglify,
            extraHeaders
        });

        const data = await buildFetchResult(await fetch(_customSignup(projectUrl, uglify), reqBuilder), uglify);

        const r = uglify ? await deserializeE2E(data, serverE2E_PublicKey, privateKey) : data;

        resolve({
            user: parseToken(r.result.token),
            token: r.result.token,
            refreshToken: r.result.refreshToken,
            isNewUser: !!r.result.isNewUser
        });
        await injectFreshToken(builder, r.result);
        revokeAuthIntance(builder, thisAuthStore);
    } catch (e) {
        reject(simplifyCaughtError(e).simpleError);
    }
});

const purgeCache = (url, isMain) => {
    if (url in Scoped.AuthJWTToken) delete Scoped.AuthJWTToken[url];
    [
        isMain ? 'EmulatedAuth' : undefined,
        'AuthStore',
        'PendingWrites'
    ].forEach(e => {
        if (e && CacheStore[e]?.[url]) delete CacheStore[e][url];
    });
    TokenRefreshListener.dispatch(url);
    triggerAuthToken(url);
};

const clearCacheForSignout = (builder, disposeEmulated) => {
    const { projectUrl } = builder;

    purgeCache(projectUrl, true);
    if (disposeEmulated) getEmulatedLinks(projectUrl).forEach(e => purgeCache(e));
    initTokenRefresher(builder);
};

export const doSignOut = async (builder) => {
    if (!Scoped.IsStoreReady) await awaitStore();
    const emulatedURL = CacheStore.EmulatedAuth[builder.projectUrl];

    clearCacheForSignout(builder, !emulatedURL);
    updateCacheStore(['AuthStore', 'EmulatedAuth']);
    if (emulatedURL) return;
    await revokeAuthIntance(builder);
};

export const revokeAuthIntance = async (builder, authStore) => {
    const { projectUrl, serverE2E_PublicKey, uglify, extraHeaders } = builder;
    const { token, refreshToken: r_token } = { ...authStore };

    if (!r_token || CacheStore.EmulatedAuth[projectUrl]) return;
    const nodeId = `${Math.random()}`;

    CacheStore.PendingAuthPurge[nodeId] = {
        auth: { token, refreshToken: r_token },
        data: { projectUrl, serverE2E_PublicKey, uglify, extraHeaders }
    };
    await purgePendingToken(nodeId);
};

export const purgePendingToken = async (nodeId) => {
    const {
        auth: { token, refreshToken: r_token },
        data: { projectUrl, serverE2E_PublicKey, uglify, extraHeaders }
    } = CacheStore.PendingAuthPurge[nodeId];

    if (!token) return;
    try {
        let isConnected;
        try {
            isConnected = (await (await fetch(_areYouOk(projectUrl), { credentials: 'omit' })).json()).status === 'yes';
        } catch (_) { }

        if (!isConnected)
            await awaitReachableServer(projectUrl);

        const [reqBuilder] = await buildFetchInterface({
            body: { token, r_token },
            uglify,
            serverE2E_PublicKey,
            extraHeaders
        });

        await buildFetchResult(await fetch(_signOut(projectUrl, uglify), reqBuilder), uglify);
    } catch (e) {
        throw simplifyCaughtError(e).simpleError;
    } finally {
        delete CacheStore.PendingAuthPurge[nodeId];
        updateCacheStore(['PendingAuthPurge']);
    }
};

const doGoogleSignin = (builder, token) => new Promise(async (resolve, reject) => {
    const { projectUrl, serverE2E_PublicKey, uglify, extraHeaders } = builder;

    try {
        await awaitStore();
        const thisAuthStore = basicClone(CacheStore.AuthStore[projectUrl]);

        const [reqBuilder, [privateKey]] = await buildFetchInterface({
            body: { token },
            uglify,
            serverE2E_PublicKey,
            extraHeaders
        });

        const data = await buildFetchResult(await fetch(_googleSignin(projectUrl, uglify), reqBuilder), uglify);

        const f = uglify ? await deserializeE2E(data, serverE2E_PublicKey, privateKey) : data;

        resolve({
            user: parseToken(f.result.token),
            token: f.result.token,
            refreshToken: f.result.refreshToken,
            isNewUser: f.result.isNewUser
        });
        await injectFreshToken(builder, f.result);
        revokeAuthIntance(builder, thisAuthStore);
    } catch (e) {
        reject(simplifyCaughtError(e).simpleError);
    }
});

const doAppleSignin = async () => {

}