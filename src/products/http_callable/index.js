import { Buffer } from "buffer";
import { cloneInstance, deserializeE2E, listenReachableServer, objToUniqueString, serializeE2E, simplifyCaughtError } from "../../helpers/peripherals";
import { awaitStore, getReachableServer, updateCacheStore, validateRequestMethod } from "../../helpers/utils";
import { RETRIEVAL, Regexs } from "../../helpers/values";
import { CacheStore, Scoped } from "../../helpers/variables";
import { awaitRefreshToken } from "../auth/accessor";

const buildFetchData = (data) => {
    const { ok, type, status, statusText, redirected, url, headers, base64, builderCred } = data;
    const { uglified, encKey, serverKey } = builderCred;

    const h = {
        arrayBuffer: async () => Buffer.from(base64, 'base64'),
        json: async () => JSON.parse(await h.text()),
        text: async () => {
            const txt = Buffer.from(base64, 'base64').toString('utf8');

            if (uglified) {
                const json = deserializeE2E(txt, serverKey, encKey);
                return `${json}`;
            } else return txt;
        },
        clone: () => ({ ...h }),
        type,
        status,
        statusText,
        redirected,
        url,
        ok,
        headers: new Headers({ ...headers }),
    };

    return h;
}

export const mfetch = async (input = '', init = {}, config) => {
    const { projectUrl, apiUrl, serverE2E_PublicKey, method, maxRetries = 7, disableCache, accessKey, uglify } = config;
    validateRequestMethod(method);

    const { retrieval = RETRIEVAL.DEFAULT, enableMinimizer, rawApproach } = method || {},
        isBaseUrl = Regexs.LINK().test(input),
        disableAuth = method?.disableAuth || isBaseUrl,
        shouldCache = (retrieval === RETRIEVAL.DEFAULT ? !disableCache : true) &&
            retrieval !== RETRIEVAL.NO_CACHE_NO_AWAIT,
        reqId = objToUniqueString({
            ...init,
            jij: { disableAuth: !!disableAuth, url: input, projectUrl, retrieval }
        });

    if ('mtoken' in (init?.headers))
        throw '"mtoken" in header is a reserved prop';

    if ('uglified' in (init?.headers || {}))
        throw '"uglified" in header is a reserved prop';

    if (input.startsWith(projectUrl) && !rawApproach)
        throw `fetchHttp first argument can not starts with projectUrl:"${projectUrl}", please set {rawApproach: true} if you're trying to access this url as it is`;

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

            const mtoken = Scoped.AuthJWTToken[projectUrl],
                uglified = (!isBaseUrl && init?.body && typeof init?.body === 'string' && uglify),
                initType = extractHeaderItem('content-type', init?.headers);

            const [reqBuilder, [privateKey]] = (uglified && isBaseUrl) ? serializeE2E(init.body, mtoken, serverE2E_PublicKey) : [null, []];

            const f = await fetch(isBaseUrl ? input : `${apiUrl}/${input}`, {
                ...isBaseUrl ? {} : { method: 'POST' },
                ...init,
                ...uglified ? { body: reqBuilder } : {},
                cache: 'no-cache',
                headers: {
                    ...isBaseUrl ? {} : { 'Content-type': 'application/json' },
                    ...init?.headers,
                    ...uglified ? {
                        uglified,
                        'Content-type': 'text/plain',
                        ...initType ? { 'init-content-type': initType } : {}
                    } : {},
                    ...((disableAuth || !mtoken || uglified || isBaseUrl) ? {} : { mtoken }),
                    ...isBaseUrl ? {} : { authorization: `Bearer ${accessKey}` }
                }
            }),
                { ok, type, status, statusText, redirected, url, headers } = f,
                simple = headers.get('simple_error');

            if (!isBaseUrl && simple) throw { simpleError: JSON.parse(simple) };

            const base64 = Buffer.from(await f.arrayBuffer()).toString('base64'),
                resObj = {
                    builderCred: {
                        uglified,
                        encKey: privateKey,
                        serverKey: serverE2E_PublicKey
                    },
                    base64,
                    type,
                    status,
                    statusText,
                    redirected,
                    url,
                    ok,
                    headers: headerObj(headers)
                };

            if (shouldCache) {
                CacheStore.FetchedStore[reqId] = { ...resObj };
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

    const r = await callFetch();
    return r;
};

const extractHeaderItem = (t = '', header) => {
    let k;
    Object.entries(header || {}).forEach(([key, value]) => {
        if (key.toLowerCase() === t.toLowerCase()) k = value;
    });
    return k;
}

const headerObj = (header) => {
    const h = {};

    header.forEach((v, k) => {
        h[k] = v;
    });

    return h;
}