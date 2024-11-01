import { io } from "socket.io-client";
import EngineApi from "../../helpers/engine_api";
import { TokenRefreshListener } from "../../helpers/listeners";
import { awaitReachableServer, awaitStore, buildFetchInterface, updateCacheStore } from "../../helpers/utils";
import { CacheStore, Scoped } from "../../helpers/variables";
import { awaitRefreshToken, initTokenRefresher, injectFreshToken, listenToken, parseToken, triggerAuthToken } from "./accessor";
import { deserializeE2E, encodeBinary, serializeE2E } from "../../helpers/peripherals";
import { simplifyCaughtError, simplifyError } from "simplify-error";

const {
    _listenUserVerification,
    _signOut,
    _customSignin,
    _customSignup,
    _googleSignin
} = EngineApi;

export class MTAuth {
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
            wasDisconnected,
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
                [reqBuilder, [privateKey]] = uglify ? serializeE2E({ mtoken }, undefined, serverE2E_PublicKey) : [null, []];

            socket = io(`${wsPrefix}://${baseUrl}`, {
                transports: ['websocket', 'polling', 'flashsocket'],
                auth: uglify ? {
                    e2e: reqBuilder,
                    _m_internal: true
                } : { mtoken, _m_internal: true }
            });

            socket.emit(_listenUserVerification(uglify));

            socket.on("onVerificationChanged", ([err, verified]) => {
                if (err) {
                    onError?.(simplifyCaughtError(err).simpleError);
                } else {
                    callback?.(uglify ? deserializeE2E(verified, serverE2E_PublicKey, privateKey) : verified);
                }
            });

            socket.on('connect', () => {
                if (wasDisconnected) socket.emit(_listenUserVerification(uglify));
            });

            socket.on('disconnect', () => {
                wasDisconnected = true;
            });
        };

        init();

        const tokenListener = listenToken(t => {
            if ((t || null) !== lastToken) {
                socket?.close?.();
                wasDisconnected = undefined;
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

    parseToken = (token) => parseToken(token);

    getAuthToken = () => new Promise(resolve => {
        const l = listenToken(t => {
            l();
            resolve(t || null);
        }, this.builder.projectUrl);
    });

    /**
     * @type {import('../../index').RNMTAuth['listenAuth']}
     */
    listenAuth = (callback) => {
        let lastTrig;

        return listenToken((t, initToken) => {
            const { refreshToken } = CacheStore.AuthStore[this.builder.projectUrl] || {};
            const parseData = t && parseToken(t);
            const tokenEntity = parseData?.entityOf || null;

            if (
                tokenEntity !== lastTrig ||
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

            lastTrig = tokenEntity;
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
};

const doCustomSignin = (builder, email, password) => new Promise(async (resolve, reject) => {
    const { projectUrl, serverE2E_PublicKey, accessKey, uglify } = builder;

    try {
        await awaitStore();
        const [reqBuilder, [privateKey]] = buildFetchInterface({
            body: { data: `${encodeBinary(email)}.${encodeBinary(password)}` },
            accessKey,
            serverE2E_PublicKey,
            uglify
        });

        const f = await (await fetch(_customSignin(projectUrl, uglify), reqBuilder)).json();
        if (f.simpleError) throw f;

        const r = uglify ? deserializeE2E(f.e2e, serverE2E_PublicKey, privateKey) : f;

        resolve({
            user: parseToken(r.result.token),
            token: r.result.token,
            refreshToken: r.result.refreshToken
        });
        await injectFreshToken(builder, r.result);
    } catch (e) {
        reject(simplifyCaughtError(e).simpleError);
    }
});

const doCustomSignup = (builder, email, password, name, metadata) => new Promise(async (resolve, reject) => {
    const { projectUrl, serverE2E_PublicKey, accessKey, uglify } = builder;

    try {
        await awaitStore();
        const [reqBuilder, [privateKey]] = buildFetchInterface({
            body: {
                data: `${encodeBinary(email)}.${encodeBinary(password)}.${(encodeBinary((name || '').trim()))}`,
                metadata,
            },
            accessKey,
            serverE2E_PublicKey,
            uglify
        });

        const f = await (await fetch(_customSignup(projectUrl, uglify), reqBuilder)).json();
        if (f.simpleError) throw f;

        const r = uglify ? deserializeE2E(f.e2e, serverE2E_PublicKey, privateKey) : f;

        resolve({
            user: parseToken(r.result.token),
            token: r.result.token,
            refreshToken: r.result.refreshToken
        });
        await injectFreshToken(builder, r.result);
    } catch (e) {
        reject(simplifyCaughtError(e).simpleError);
    }
});

const clearCacheForSignout = (projectUrl) => {
    TokenRefreshListener.dispatch(projectUrl);
    if (CacheStore.AuthStore[projectUrl]) delete CacheStore.AuthStore[projectUrl];
    if (Scoped.AuthJWTToken[projectUrl]) delete Scoped.AuthJWTToken[projectUrl];
    Object.keys(CacheStore).forEach(e => {
        if (CacheStore[e][projectUrl]) delete CacheStore[e][projectUrl];
    });
    triggerAuthToken(projectUrl);
    initTokenRefresher(builder);
};

export const doSignOut = async (builder) => {
    await awaitStore();

    const { projectUrl, serverE2E_PublicKey, accessKey, uglify } = builder,
        { token, refreshToken: r_token } = CacheStore.AuthStore[projectUrl];

    clearCacheForSignout(projectUrl);
    // TODO: sychronise signout
    updateCacheStore();

    if (token) {
        try {
            await awaitReachableServer(projectUrl);

            const [reqBuilder] = buildFetchInterface({
                body: { token, r_token },
                accessKey,
                uglify,
                serverE2E_PublicKey
            });

            const r = await (await fetch(_signOut(projectUrl, uglify), reqBuilder)).json();
            if (r.simpleError) throw r;
        } catch (e) {
            throw simplifyCaughtError(e).simpleError;
        }
    }
};

const doGoogleSignin = (builder, token) => new Promise(async (resolve, reject) => {
    const { projectUrl, serverE2E_PublicKey, accessKey, uglify } = builder;

    try {
        await awaitStore();
        const [reqBuilder, [privateKey]] = buildFetchInterface({
            body: { token },
            accessKey,
            uglify,
            serverE2E_PublicKey
        });

        const r = await (await fetch(_googleSignin(projectUrl, uglify), reqBuilder)).json();
        if (r.simpleError) throw r;

        const f = uglify ? deserializeE2E(r.e2e, serverE2E_PublicKey, privateKey) : r;

        resolve({
            user: parseToken(f.result.token),
            token: f.result.token,
            refreshToken: f.result.refreshToken,
            isNewUser: f.result.isNewUser
        });
        await injectFreshToken(builder, f.result);
    } catch (e) {
        reject(simplifyCaughtError(e).simpleError);
    }
});

const doAppleSignin = async () => {

}