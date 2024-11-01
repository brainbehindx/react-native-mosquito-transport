import { Buffer } from "buffer";
import { deserializeE2E, listenReachableServer, niceHash, serializeE2E } from "../../helpers/peripherals";
import { awaitStore, getReachableServer, updateCacheStore } from "../../helpers/utils";
import { RETRIEVAL } from "../../helpers/values";
import { CacheStore, Scoped } from "../../helpers/variables";
import { awaitRefreshToken } from "../auth/accessor";
import { simplifyCaughtError } from "simplify-error";
import { guardObject, Validator } from "guard-object";
import cloneDeep from "lodash.clonedeep";

const buildFetchData = (data) => {
    const { ok, type, status, statusText, redirected, url, headers, size, base64 } = data;

    const response = new Response(Buffer.from(base64, 'base64'), {
        headers: new Headers(headers),
        status,
        statusText,
        url,
        size
    });

    Object.entries({ ok, type, url, redirected, size })
        .forEach(([k, v]) => {
            if (response[k] !== v)
                Object.defineProperty(response, k, {
                    value: v,
                    writable: false
                });
        });

    return response;
}

export const mfetch = async (input = '', init, config) => {
    const { projectUrl, serverE2E_PublicKey, method, maxRetries = 7, disableCache, accessKey, uglify } = config;
    const { headers, body } = init || {};

    if (config !== undefined)
        guardObject({
            enableMinimizer: t => t === undefined || Validator.BOOLEAN(t),
            rawApproach: t => t === undefined || Validator.BOOLEAN(t),
            disableAuth: t => t === undefined || Validator.BOOLEAN(t),
            retrieval: t => t === undefined || Object.values(RETRIEVAL).includes(t)
        }).validate(method);

    const { retrieval = RETRIEVAL.DEFAULT, enableMinimizer, rawApproach } = method || {};
    const isBaseUrl = Validator.LINK(input);
    const disableAuth = method?.disableAuth || isBaseUrl;
    const shouldCache = (retrieval !== RETRIEVAL.DEFAULT || !disableCache) &&
        retrieval !== RETRIEVAL.NO_CACHE_NO_AWAIT;
    const rawHeader = Object.fromEntries(
        [...new Headers(headers).entries()]
    );

    if ('mtoken' in rawHeader)
        throw '"mtoken" in header is a reserved prop';

    if ('uglified' in rawHeader)
        throw '"uglified" in header is a reserved prop';

    if (input.startsWith(projectUrl) && !rawApproach)
        throw `please set { rawApproach: true } if you're trying to access different endpoint at "${input}"`;

    if (body !== undefined && typeof body !== 'string')
        throw `"body" must be a string value`;

    const reqId = niceHash(
        JSON.stringify([
            rawHeader,
            body,
            !!disableAuth,
            input
        ])
    );

    let retries = 0, hasFinalize;

    const callFetch = () => new Promise(async (resolve, reject) => {
        const retryProcess = ++retries;

        const finalize = (a, b) => {
            if (a) resolve(a);
            else reject(b);
            if (hasFinalize || retryProcess !== 1) return;
            hasFinalize = true;

            if (enableMinimizer) {
                (Scoped.PendingFetchCollective.pendingResolution[reqId] || []).forEach(e => {
                    e(a, b);
                });
                if (Scoped.PendingFetchCollective.pendingResolution[reqId])
                    delete Scoped.PendingFetchCollective.pendingResolution[reqId];

                if (Scoped.PendingFetchCollective.pendingProcess[reqId])
                    delete Scoped.PendingFetchCollective.pendingProcess[reqId];
            }
        };

        await awaitStore();
        const reqData = CacheStore.FetchedStore[projectUrl]?.[reqId];
        const resolveCache = () => {
            finalize({
                ...buildFetchData(reqData),
                fromCache: true
            });
        };

        try {
            if (retryProcess === 1) {
                if (enableMinimizer) {
                    if (Scoped.PendingFetchCollective.pendingProcess[reqId]) {
                        if (!Scoped.PendingFetchCollective.pendingResolution[reqId])
                            Scoped.PendingFetchCollective.pendingResolution[reqId] = [];

                        Scoped.PendingFetchCollective.pendingResolution[reqId].push((a, b) => {
                            if (a) resolve(cloneDeep(a.result));
                            else reject(cloneDeep(b));
                        });
                        return;
                    }
                    Scoped.PendingFetchCollective.pendingProcess[reqId] = true;
                }

                if (retrieval.startsWith('sticky') && reqData) {
                    resolveCache();
                    if (retrieval !== RETRIEVAL.STICKY_RELOAD) return;
                }
            }

            if (!disableAuth && await getReachableServer(projectUrl))
                await awaitRefreshToken(projectUrl);

            const mtoken = Scoped.AuthJWTToken[projectUrl];
            const uglified = !!(!isBaseUrl && body && uglify);
            const initType = rawHeader['content-type'];

            const [reqBuilder, [privateKey]] = uglified ? serializeE2E(body, mtoken, serverE2E_PublicKey) : [null, []];

            const f = await fetch(isBaseUrl ? input : `${projectUrl}/${input}`, {
                ...isBaseUrl ? {} : { method: 'POST' },
                ...init,
                ...uglified ? { body: reqBuilder } : {},
                cache: 'no-cache',
                headers: {
                    ...isBaseUrl ? {} : { 'Content-type': 'application/json' },
                    ...headers,
                    ...uglified ? {
                        uglified,
                        'content-type': 'text/plain',
                        ...initType ? { 'init-content-type': initType } : {}
                    } : {},
                    ...(disableAuth || !mtoken || uglified || isBaseUrl) ? {} : { mtoken },
                    ...isBaseUrl ? {} : { authorization: `Bearer ${accessKey}` }
                }
            });
            const { ok, type, status, statusText, redirected, url, headers, size } = f;
            const simple = headers.get('simple_error');

            if (!isBaseUrl && simple) throw { simpleError: JSON.parse(simple) };

            const base64 = uglified ?
                Buffer.from(deserializeE2E(await f.text(), serverE2E_PublicKey, privateKey), 'base64') :
                Buffer.from(await f.arrayBuffer()).toString('base64');

            const resObj = {
                base64,
                type,
                status,
                statusText,
                redirected,
                url,
                ok,
                size,
                headers: Object.fromEntries(
                    [...headers.entries()]
                )
            };

            if (shouldCache) {
                if (!CacheStore.FetchedStore[projectUrl])
                    CacheStore.FetchedStore[projectUrl] = {};
                CacheStore.FetchedStore[projectUrl][reqId] = cloneDeep(resObj);
                updateCacheStore();
            }

            finalize(buildFetchData(resObj));
        } catch (e) {
            if (e?.simpleError) {
                finalize(undefined, e.simpleError);
            } else if (
                (retrieval === RETRIEVAL.CACHE_NO_AWAIT && !reqData) ||
                retrieval === RETRIEVAL.STICKY_NO_AWAIT ||
                retrieval === RETRIEVAL.NO_CACHE_NO_AWAIT
            ) {
                finalize(undefined, simplifyCaughtError(e).simpleError);
            } else if (
                shouldCache &&
                (retrieval === RETRIEVAL.DEFAULT || retrieval === RETRIEVAL.CACHE_NO_AWAIT) &&
                reqData
            ) {
                resolveCache();
            } else if (retries >= maxRetries) {
                finalize(undefined, simplifyCaughtError(e).simpleError);
            } else {
                const listener = listenReachableServer(async online => {
                    if (online) {
                        listener();
                        callFetch().then(
                            e => {
                                if (retryProcess === 1) {
                                    finalize(e);
                                } else resolve(e);
                            },
                            e => {
                                if (retryProcess === 1) {
                                    finalize(undefined, e);
                                } else reject(e);
                            }
                        );
                    }
                }, projectUrl);
            }
        }
    });

    return await callFetch();
};