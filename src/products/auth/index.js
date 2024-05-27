import { io } from "socket.io-client";
import EngineApi from "../../helpers/EngineApi";
import { TokenRefreshListener } from "../../helpers/listeners";
import { awaitReachableServer, awaitStore, buildFetchInterface, simplifyError, updateCacheStore } from "../../helpers/utils";
import { CacheConstant, CacheStore, Scoped } from "../../helpers/variables";
import { awaitRefreshToken, initTokenRefresher, injectFreshToken, listenToken, parseToken, triggerAuthToken } from "./accessor";
import { deserializeE2E, encodeBinary, serializeE2E, simplifyCaughtError } from "../../helpers/peripherals";

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

    }

    facebookSignin() {

    }

    twitterSignin() {

    }

    githubSignin() {

    }

    listenVerifiedStatus(callback, onError) {
        const { projectUrl, serverE2E_PublicKey, uglify, baseUrl, wsPrefix } = this.builder;

        let socket, wasDisconnected, lastToken = Scoped.AuthJWTToken[projectUrl] || null, lastInitRef = 0;

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
                auth: uglify ? {
                    e2e: reqBuilder,
                    _m_internal: true
                } : { mtoken, _m_internal: true }
            });

            socket.emit(_listenUserVerification(uglify));

            socket.on("onVerificationChanged", ([err, verified]) => {
                const fatal = err ? simplifyCaughtError(err).simpleError : undefined;
                if (fatal) {
                    onError?.(fatal);
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
            socket?.close?.();
            tokenListener?.();
        }
    }

    listenAuthToken = (callback) => listenToken(callback, this.builder.projectUrl);

    getAuthToken = () => new Promise(resolve => {
        const l = listenToken(t => {
            l();
            resolve(t || null);
        }, this.builder.projectUrl);
    });

    listenAuth = (callback) => {
        let lastTrig;

        return listenToken((t, initToken) => {
            const { refreshToken } = CacheStore.AuthStore[this.builder.projectUrl] || {};

            if (
                (!!t || null) !== lastTrig ||
                initToken
            ) callback(t ? {
                ...parseToken(t),
                tokenManager: {
                    refreshToken,
                    accessToken: t
                }
            } : null);

            lastTrig = !!t || null;
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
}

const doCustomSignin = (builder, email, password) => new Promise(async (resolve, reject) => {
    const { projectUrl, serverE2E_PublicKey, accessKey, uglify } = builder;

    try {
        await awaitStore();
        const [reqBuilder, [privateKey]] = buildFetchInterface({
            body: { _: `${encodeBinary(email)}.${encodeBinary(password)}` },
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
                _: `${encodeBinary(email)}.${encodeBinary(password)}.${(encodeBinary(name || '').trim())}`,
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

export const doSignOut = async (builder) => {
    await awaitStore();

    const { projectUrl, serverE2E_PublicKey, accessKey, uglify } = builder,
        { token, refreshToken: r_token } = CacheStore.AuthStore[projectUrl];

    TokenRefreshListener.dispatch(projectUrl);
    if (CacheStore.AuthStore[projectUrl]) delete CacheStore.AuthStore[projectUrl];
    if (token) delete Scoped.AuthJWTToken[projectUrl];
    Object.keys(CacheConstant).forEach(e => {
        CacheStore[e] = CacheConstant[e];
    });
    triggerAuthToken(projectUrl);
    updateCacheStore();
    initTokenRefresher(builder);

    if (token) {
        TokenRefreshListener.dispatch(projectUrl, 'ready');
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
}

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

const validateEmailAndPassword = () => { }

const getAuthState = async (projectUrl) => {

}