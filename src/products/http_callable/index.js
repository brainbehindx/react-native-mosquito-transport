import { Buffer } from "buffer";
import { deserializeE2E, listenReachableServer, niceHash, normalizeRoute, serializeE2E } from "../../helpers/peripherals";
import { awaitStore, getReachableServer, updateCacheStore } from "../../helpers/utils";
import { RETRIEVAL } from "../../helpers/values";
import { CacheStore, Scoped } from "../../helpers/variables";
import { awaitRefreshToken } from "../auth/accessor";
import { simplifyCaughtError } from "simplify-error";
import { guardObject, Validator } from "guard-object";
import cloneDeep from "lodash/cloneDeep";
import { serialize } from "entity-serializer";

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
    const { projectUrl, serverE2E_PublicKey, method, maxRetries = 7, disableCache, uglify, extraHeaders } = config;
    const { headers, body } = init || {};

    if (method !== undefined)
        guardObject({
            enableMinimizer: t => t === undefined || Validator.BOOLEAN(t),
            rawApproach: t => t === undefined || Validator.BOOLEAN(t),
            disableAuth: t => t === undefined || Validator.BOOLEAN(t),
            retrieval: t => t === undefined || Object.values(RETRIEVAL).includes(t)
        }).validate(method);

    const { retrieval = RETRIEVAL.DEFAULT, enableMinimizer, rawApproach } = method || {};
    const isLink = Validator.LINK(input);
    const isBaseUrl = isLink || rawApproach;
    const disableAuth = method?.disableAuth || isBaseUrl;
    const shouldCache = (retrieval !== RETRIEVAL.DEFAULT || (disableCache === undefined ? body === undefined : !disableCache)) &&
        ![RETRIEVAL.NO_CACHE_NO_AWAIT, RETRIEVAL.NO_CACHE_AWAIT].includes(retrieval);
    const uglified = !!(!isBaseUrl && uglify);

    const rawHeader = Object.fromEntries(
        [...new Headers(headers).entries()]
    );

    ['mtoken', 'uglified'].forEach(e => {
        if ([e] in rawHeader)
            throw `"${e}" in header is a reserved prop`;
    });

    // if (isBaseUrl && !rawApproach)
    //     throw `please set { rawApproach: true } if you're trying to access different endpoint at "${input}"`;

    if (body !== undefined) {
        if (
            typeof body !== 'string' &&
            !Buffer.isBuffer(body) &&
            !Validator.JSON(body)
        ) throw `"body" must be any of string, buffer, object`;
    }

    const reqId = await niceHash(
        serialize([
            rawHeader,
            body,
            !!disableAuth,
            input
        ]).toString('base64')
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
            const initType = rawHeader['content-type'];

            const [reqBuilder, [privateKey]] = uglified ? await serializeE2E(body, mtoken, serverE2E_PublicKey) : [null, []];

            const f = await fetch(isLink ? input : `${projectUrl}/${normalizeRoute(input)}`, {
                ...(!isBaseUrl || body) ? { method: 'POST' } : {},
                ...init,
                ...uglified ? { body: reqBuilder } : {},
                // cache: 'no-cache',
                headers: {
                    ...extraHeaders,
                    ...isBaseUrl ? {} : { 'content-type': 'application/json' },
                    ...rawHeader,
                    ...uglified ? {
                        uglified,
                        'content-type': 'request/buffer',
                        ...initType ? { 'init-content-type': initType } : {}
                    } : {},
                    ...(disableAuth || !mtoken || uglified || isBaseUrl) ? {} : { mtoken }
                }
            });
            const { ok, type, status, statusText, redirected, url, headers, size } = f;
            const simple = headers.get('simple_error');

            if (!isBaseUrl && simple) throw { simpleError: JSON.parse(simple) };

            const base64 = uglified ?
                Buffer.from(await deserializeE2E(await f.arrayBuffer(), serverE2E_PublicKey, privateKey)).toString('base64') :
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