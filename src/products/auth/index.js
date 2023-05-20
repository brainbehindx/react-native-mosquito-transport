import { io } from "socket.io-client";
import EngineApi from "../../helpers/EngineApi";
import { AuthListener, AuthTokenListener, TokenRefreshListener } from "../../helpers/listeners";
import { awaitStore, buildFetchInterface, simplifyError, updateCacheStore } from "../../helpers/utils";
import { CacheConstant, CacheStore, Scoped } from "../../helpers/variables";
import { initTokenRefresher, injectFreshToken, triggerAuth, triggerAuthToken } from "./accessor";

export class MosquitoDbAuth {
    constructor(config) {
        this.builder = { ...config };
    }

    customSignin = (email, password) => doCustomSignin(this.builder, email, password, this);

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

    listenVerifiedStatus(callback) {
        if (!Scoped.AuthJWTToken[projectUrl]) {
            callback(simplifyError('user_login_required', 'You must be signed-in to use this method').simpleError);
            return () => { };
        }

        const { projectUrl } = this.builder,
            socket = io(`ws://${projectUrl.split('://')[1]}`, { extraHeaders: { mtoken: Scoped.AuthJWTToken[projectUrl] } });

        socket.emit("_listenUserVerification");

        socket.on("onVerificationChanged", ([err, verified]) => {
            if (err) socket.close();
            callback?.(
                err ? (err?.simpleError || simplifyError('unexpected_error', `${err}`).simpleError) : undefined,
                verified
            );
        });

        return () => {
            socket.close();
        }
    }

    listenAuthToken = (callback) =>
        AuthTokenListener[this.builder.projectUrl].startListener(t => {
            if (t === 'loading') return;
            callback?.(t || null);
        }, true);

    getAuthToken = () => new Promise(resolve => {
        const l = AuthTokenListener[this.builder.projectUrl].startListener(t => {
            if (t === 'loading') return;
            l();
            resolve(t || null);
        }, true);
    });

    listenAuth = (callback) =>
        AuthListener[this.builder.projectUrl].startListener(t => {
            if (t === 'loading') return;
            callback?.(t || null);
        }, true);

    getAuth = () => new Promise(resolve => {
        const l = AuthListener[this.builder.projectUrl].startListener(t => {
            if (t === 'loading') return;
            l();
            resolve(t || null);
        }, true);
    });

    signOut = () => doSignOut(this.builder);

    forceRefreshToken = () => initTokenRefresher(this.builder, true);
}

const doCustomSignin = async (builder, email, password, that) => {
    const { projectUrl, accessKey } = builder;

    try {
        const r = await (await fetch(EngineApi._customSignin(projectUrl), buildFetchInterface({
            _: `${btoa(email)}</>${btoa(password)}`
        }, accessKey))).json();
        if (r.simpleError) throw r;
        await injectFreshToken(projectUrl, r.result);
        return { user: await that.getAuth(), token: r.result.token };
    } catch (e) {
        throw e?.simpleError || { error: 'unexpected_error', message: `Error: ${e}` };
    }
}

const doCustomSignup = async (builder, email, password, name, metadata, that) => {
    const { projectUrl, accessKey } = builder;

    try {
        const r = await (await fetch(EngineApi._customSignup(projectUrl), buildFetchInterface({
            _: `${btoa(email)}</>${btoa(password)}</>${(btoa(name || '').trim())}`,
            metadata
        }, accessKey))).json();
        if (r.simpleError) throw r;
        await injectFreshToken(projectUrl, r.result);
        return { user: await that.getAuth(), token: r.result.token };
    } catch (e) {
        throw e?.simpleError || { error: 'unexpected_error', message: `Error: ${e}` };
    }
}

export const doSignOut = async (builder) => {
    await awaitStore();
    const { projectUrl, accessKey } = builder,
        lastestToken = Scoped.AuthJWTToken[projectUrl];

    if (CacheStore.AuthStore[projectUrl]) delete CacheStore.AuthStore[projectUrl];
    if (lastestToken) delete Scoped.AuthJWTToken[projectUrl];
    Object.keys(CacheConstant).forEach(e => {
        CacheStore[e] = CacheConstant[e];
    })
    triggerAuth();
    triggerAuthToken();
    updateCacheStore();

    if (lastestToken) {
        TokenRefreshListener[projectUrl].triggerListener('ready');
        try {
            const r = await (await fetch(EngineApi._signOut(projectUrl), buildFetchInterface({
                _: lastestToken
            }, accessKey))).json();
            if (r.simpleError) throw r;
        } catch (e) {
            throw e?.simpleError || { error: 'unexpected_error', message: `Error: ${e}` };
        }
    }
}

const doGoogleSignin = async (builder, token, that) => {
    const { projectUrl, accessKey } = builder;

    try {
        const r = await (await fetch(EngineApi._googleSignin(projectUrl), buildFetchInterface({
            _: token
        }, accessKey))).json();
        if (r.simpleError) throw r;
        await injectFreshToken(projectUrl, r.result);
        return { user: await that.getAuth(), token: r.result.token };
    } catch (e) {
        throw e?.simpleError || { error: 'unexpected_error', message: `Error: ${e}` };
    }
}

const doAppleSignin = async () => {

}

const validateEmailAndPassword = () => { }

const getAuthState = async (projectUrl) => {

}