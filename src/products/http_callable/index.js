import { Buffer } from "buffer";
import { cloneInstance, decryptString, encryptString, listenReachableServer, niceTry, objToUniqueString, simplifyCaughtError } from "../../helpers/peripherals";
import { awaitStore, getReachableServer, updateCacheStore, validateRequestMethod } from "../../helpers/utils";
import { RETRIEVAL } from "../../helpers/values";
import { CacheStore, Scoped } from "../../helpers/variables";
import { awaitRefreshToken } from "../auth/accessor";

export const mfetch = async (input = '', init = {}, config) => {
    const { projectUrl, apiUrl, method, maxRetries = 7, disableCache, accessKey, uglify } = config;
    validateRequestMethod(method);

    const { retrieval = RETRIEVAL.DEFAULT, enableMinimizer } = method || {},
        isBaseUrl = input.includes('://'),
        disableAuth = method?.disableAuth || isBaseUrl,
        shouldCache = (retrieval === RETRIEVAL.DEFAULT ? !disableCache : true) &&
            retrieval !== RETRIEVAL.NO_CACHE_NO_AWAIT,
        reqId = objToUniqueString({
            ...init,
            jij: { disableAuth: !!disableAuth, url: input, projectUrl, retrieval }
        });

    if (init?.headers?.mtoken)
        throw '"mtoken" in header is a reserved prop';

    if (init?.headers?.uglified)
        throw '"uglified" in header is a reserved prop';

    if (input.startsWith(projectUrl))
        throw `makeRequest can not starts with projectUrl:"${projectUrl}"`;

    if (!isBaseUrl && init.body && typeof init.body !== 'string')
        throw `"body" must be a string value`;

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
                    e(cloneInstance(a), b);
                });
                if (Scoped.PendingFetchCollective.pendingResolution[reqId])
                    delete Scoped.PendingFetchCollective.pendingResolution[reqId];

                if (Scoped.PendingFetchCollective.pendingProcess[reqId])
                    delete Scoped.PendingFetchCollective.pendingProcess[reqId];
            }
        };

        await awaitStore();
        const reqData = CacheStore.FetchedStore[reqId],
            resolveCache = () => {
                const { ok, type, status, statusText, redirected, url, headers, base64, json } = reqData;
                const bj = {
                    arrayBuffer: async () => Buffer.from(base64, 'base64'),
                    json: async () => JSON.parse(json),
                    text: async () => {
                        const txt = Buffer.from(base64, 'base64').toString('utf8');
                        return txt;
                    },
                    clone: () => ({ ...bj }),
                    type,
                    status,
                    statusText, redirected,
                    url,
                    ok,
                    headers: new Headers({ ...headers }),
                    fromCache: true
                };

                finalize(bj);
            };

        try {

            if (retryProcess === 1) {
                if (enableMinimizer) {
                    if (Scoped.PendingFetchCollective.pendingProcess[reqId]) {
                        if (!Scoped.PendingFetchCollective.pendingResolution[reqId])
                            Scoped.PendingFetchCollective.pendingResolution[reqId] = [];

                        Scoped.PendingFetchCollective.pendingResolution[reqId].push((a, b) => {
                            if (a) resolve(a.result);
                            else reject(b);
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

            const { encryptionKey = accessKey } = CacheStore.AuthStore?.[projectUrl]?.tokenData || {},
                mtoken = Scoped.AuthJWTToken[projectUrl],
                uglified = (!isBaseUrl && init?.body && typeof init?.body === 'string' && uglify);

            const f = await fetch(isBaseUrl ? input : `${apiUrl}/${input}`, {
                ...isBaseUrl ? {} : { method: 'POST' },
                ...init,
                ...uglified
                    ? { body: { __: encryptString(init.body, accessKey, disableAuth ? accessKey : encryptionKey) } } : {},
                cache: 'no-cache',
                headers: {
                    ...isBaseUrl ? {} : { 'Content-type': 'application/json' },
                    ...init?.headers,
                    ...uglified ? { uglified } : {},
                    ...((disableAuth || !mtoken) ? {} : { mtoken }),
                    ...isBaseUrl ? {} : { authorization: `Bearer ${encryptString(accessKey, accessKey, '_')}` }
                }
            }),
                { ok, type, status, statusText, redirected, url, headers } = f,
                simple = headers.get('simple_error'),
                [arrayBuffer, json] = await Promise.all([
                    niceTry(() => f.clone().arrayBuffer()),
                    niceTry(async () => {
                        const j = await f.clone().json(),
                            json = uglified ? JSON.parse(decryptString(j.__, accessKey, disableAuth ? accessKey : encryptionKey)) : j;
                        return JSON.stringify(json);
                    })
                ]),
                base64 = arrayBuffer ? Buffer.from(arrayBuffer).toString('base64') : '',
                resObj = {
                    json,
                    type,
                    status,
                    statusText,
                    redirected,
                    url,
                    ok,
                    headers: headerObj(headers)
                };

            if (!isBaseUrl && simple) throw { simpleError: JSON.parse(simple) };

            if (shouldCache) {
                CacheStore.FetchedStore[reqId] = { ...resObj, base64 };
                updateCacheStore();
            }

            const cloneObj = {
                ...resObj,
                headers: new Headers(resObj.headers),
                arrayBuffer: async () => Buffer.from(base64, 'base64'),
                json: async () => JSON.parse(json),
                text: async () => {
                    const txt = Buffer.from(base64, 'base64').toString('utf8');
                    return txt;
                },
                clone: () => ({ ...cloneObj })
            };

            finalize(cloneObj);
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

    const r = await callFetch();
    return r;
};

const headerObj = (header) => {
    const h = {};

    header.forEach((v, k) => {
        h[k] = v;
    });

    return h;
}