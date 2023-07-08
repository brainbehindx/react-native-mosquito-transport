import { io } from "socket.io-client";
import EngineApi from "../../helpers/EngineApi";
import { AuthListener, AuthTokenListener, TokenRefreshListener } from "../../helpers/listeners";
import { awaitReachableServer, awaitStore, buildFetchInterface, simplifyError, updateCacheStore } from "../../helpers/utils";
import { CacheConstant, CacheStore, Scoped } from "../../helpers/variables";
import { awaitRefreshToken, initTokenRefresher, injectFreshToken, listenToken, triggerAuth, triggerAuthToken } from "./accessor";

export class MosquitoDbAuth {
    constructor(config) {
        this.builder = { ...config };
    }

    customSignin = (email, password) => doCustomSignin(this.builder, email, password);

    customSignup = (email, password, name, metadata) => doCustomSignup(this.builder, email, password, name, metadata, this);

    googleSignin = (token) => doGoogleSignin(this.builder, token, this);

    appleSignin() {

    }

    facebookSignin() {

    }

    twitterSignin() {

    }

    githubSignin() {

    }

    listenVerifiedStatus(callback, onError) {
        const { projectUrl } = this.builder;

        let socket, wasDisconnected, lastToken = Scoped.AuthJWTToken[projectUrl] || null, lastInitRef = 0;

        const init = async () => {
            const processID = ++lastInitRef;
            await awaitRefreshToken(projectUrl);

            if (!Scoped.AuthJWTToken[projectUrl]) {
                onError?.(simplifyError('user_login_required', 'You must be signed-in to use this method').simpleError);
                return;
            }
            if (processID !== lastInitRef) return;

            socket = io(`ws://${projectUrl.split('://')[1]}`, { extraHeaders: { mtoken: Scoped.AuthJWTToken[projectUrl] } });

            socket.emit("_listenUserVerification");

            socket.on("onVerificationChanged", ([err, verified]) => {
                // if (err) socket.close();
                const fatal = err ? (err?.simpleError || simplifyError('unexpected_error', `${err}`).simpleError) : undefined;
                if (fatal) {
                    onError?.(fatal);
                } else callback?.(verified);
            });

            socket.on('connect', () => {
                if (wasDisconnected) socket.emit('_listenUserVerification');
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
        const l = AuthTokenListener.startKeyListener(this.builder.projectUrl, t => {
            if (t === undefined) return;
            l();
            resolve(t || null);
        }, true);
    });

    listenAuth = (callback) =>
        AuthListener.startKeyListener(this.builder.projectUrl, t => {
            if (t === undefined) return;
            callback?.(t || null);
        }, true);

    getAuth = () => new Promise(resolve => {
        const l = AuthListener.startKeyListener(this.builder.projectUrl, t => {
            if (t === undefined) return;
            l();
            resolve(t || null);
        }, true);
    });

    signOut = () => doSignOut(this.builder);

    forceRefreshToken = () => initTokenRefresher(this.builder, true);
}

const doCustomSignin = (builder, email, password) => new Promise(async (resolve, reject) => {
    const { projectUrl, accessKey } = builder;

    try {
        await awaitStore();
        const r = await (await fetch(EngineApi._customSignin(projectUrl), buildFetchInterface({
            _: `${btoa(email)}</>${btoa(password)}`
        }, accessKey))).json();
        if (r.simpleError) throw r;
        resolve({ user: r.result.tokenData, token: r.result.token });
        await injectFreshToken(builder, r.result);
    } catch (e) {
        reject(e?.simpleError || { error: 'unexpected_error', message: `Error: ${e}` });
    }
});

const doCustomSignup = (builder, email, password, name, metadata) => new Promise(async (resolve, reject) => {
    const { projectUrl, accessKey } = builder;

    try {
        await awaitStore();
        const r = await (await fetch(EngineApi._customSignup(projectUrl), buildFetchInterface({
            _: `${btoa(email)}</>${btoa(password)}</>${(btoa(name || '').trim())}`,
            metadata
        }, accessKey))).json();
        if (r.simpleError) throw r;
        resolve({ user: r.result.tokenData, token: r.result.token });
        await injectFreshToken(builder, r.result);
    } catch (e) {
        reject(e?.simpleError || { error: 'unexpected_error', message: `Error: ${e}` });
    }
});

export const doSignOut = async (builder) => {
    await awaitStore();
    const { projectUrl, accessKey } = builder,
        lastestToken = Scoped.AuthJWTToken[projectUrl];

    if (CacheStore.AuthStore[projectUrl]) delete CacheStore.AuthStore[projectUrl];
    if (lastestToken) delete Scoped.AuthJWTToken[projectUrl];
    Object.keys(CacheConstant).forEach(e => {
        CacheStore[e] = CacheConstant[e];
    })
    triggerAuth(projectUrl);
    triggerAuthToken(projectUrl);
    updateCacheStore();

    if (lastestToken) {
        TokenRefreshListener.triggerKeyListener(projectUrl, 'ready');
        try {
            await awaitReachableServer(projectUrl);
            const r = await (await fetch(EngineApi._signOut(projectUrl), buildFetchInterface({
                _: lastestToken
            }, accessKey))).json();
            if (r.simpleError) throw r;
        } catch (e) {
            throw e?.simpleError || { error: 'unexpected_error', message: `Error: ${e}` };
        }
    }
}

const doGoogleSignin = (builder, token) => new Promise(async (resolve, reject) => {
    const { projectUrl, accessKey } = builder;

    try {
        await awaitStore();
        const r = await (await fetch(EngineApi._googleSignin(projectUrl), buildFetchInterface({
            _: token
        }, accessKey))).json();
        if (r.simpleError) throw r;
        resolve({ user: r.result.tokenData, token: r.result.token, isNewUser: r.isNewUser });
        await injectFreshToken(builder, r.result);
    } catch (e) {
        reject(e?.simpleError || { error: 'unexpected_error', message: `Error: ${e}` });
    }
});

const doAppleSignin = async () => {

}

const validateEmailAndPassword = () => { }

const getAuthState = async (projectUrl) => {

}