import { Buffer } from "buffer";
import { deserializeE2E, listenReachableServer, niceHash, normalizeRoute, serializeE2E } from "../../helpers/peripherals";
import { awaitStore, getReachableServer } from "../../helpers/utils";
import { RETRIEVAL } from "../../helpers/values";
import { Scoped } from "../../helpers/variables";
import { awaitRefreshToken } from "../auth/accessor";
import { simplifyCaughtError } from "simplify-error";
import { guardObject, Validator } from "guard-object";
import cloneDeep from "lodash/cloneDeep";
import { serialize } from "entity-serializer";
import { getFetchResources, insertFetchResources } from "./accessor";

const buildFetchData = (data, extras) => {
    const { ok, type, status, statusText, redirected, url, headers, size, buffer } = data;

    const response = new Response(buffer, {
        headers: new Headers(headers),
        status,
        statusText,
        url,
        size
    });

    Object.entries({ ok, type, url, redirected, size, ...extras })
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
    const { projectUrl, serverE2E_PublicKey, method, maxRetries = 1, disableCache = false, uglify, extraHeaders } = config;
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
    const disableAuth = method?.disableAuth === undefined ? isBaseUrl : method?.disableAuth;
    const hasBody = body !== undefined;
    const shouldCache = (retrieval !== RETRIEVAL.DEFAULT || (config.disableCache === undefined ? !hasBody : !disableCache)) &&
        ![RETRIEVAL.NO_CACHE_NO_AWAIT, RETRIEVAL.NO_CACHE_AWAIT].includes(retrieval);
    const uglified = !!(!isBaseUrl && uglify);

    const rawHeader = Object.fromEntries(
        [...new Headers(headers).entries()]
    );

    ['mtoken', 'uglified'].forEach(e => {
        if ([e] in rawHeader)
            throw `"${e}" in header is a reserved prop`;
    });

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
    const processReqId = `${reqId}_${disableCache}_${retrieval}`;

    let retries = 0, hasFinalize;

    const callFetch = () => new Promise(async (resolve, reject) => {
        const retryProcess = ++retries;

        const finalize = (a, b) => {
            if (a) resolve(a);
            else reject(b);
            if (hasFinalize || retryProcess !== 1) return;
            hasFinalize = true;

            if (enableMinimizer) {
                const resolutionList = (Scoped.PendingFetchCollective[processReqId] || []).slice(0);

                if (Scoped.PendingFetchCollective[processReqId])
                    delete Scoped.PendingFetchCollective[processReqId];

                resolutionList.forEach(e => {
                    e(a, b);
                });
            }
        };

        await awaitStore();
        const resolveCache = (reqData) => {
            finalize(buildFetchData(reqData, { fromCache: true }));
        };

        try {
            if (retryProcess === 1) {
                if (enableMinimizer) {
                    if (Scoped.PendingFetchCollective[processReqId]) {
                        Scoped.PendingFetchCollective[processReqId].push((a, b) => {
                            if (a) resolve(cloneDeep(a.result));
                            else reject(cloneDeep(b));
                        });
                        return;
                    }
                    Scoped.PendingFetchCollective[processReqId] = [];
                }

                let reqData;
                if (
                    retrieval.startsWith('sticky') &&
                    (reqData = await getFetchResources(projectUrl, reqId))
                ) {
                    resolveCache(reqData);
                    if (retrieval !== RETRIEVAL.STICKY_RELOAD) return;
                }
            }

            if (!disableAuth && await getReachableServer(projectUrl))
                await awaitRefreshToken(projectUrl);

            const mtoken = disableAuth ? undefined : Scoped.AuthJWTToken[projectUrl];
            const initType = rawHeader['content-type'];
            const encodeBody = initType === undefined && hasBody && !isBaseUrl;

            const [reqBuilder, [privateKey]] = uglified ? await serializeE2E(body, mtoken, serverE2E_PublicKey) : [null, []];

            const f = await fetch(isLink ? input : `${projectUrl}/${normalizeRoute(input)}`, {
                ...(!isBaseUrl || hasBody) ? { method: 'POST' } : {},
                credentials: 'omit',
                ...init,
                ...uglified ? { body: reqBuilder } : encodeBody ? { body: serialize(body) } : {},
                // cache: 'no-cache',
                headers: {
                    ...extraHeaders,
                    ...rawHeader,
                    ...uglified ? {
                        uglified,
                        'content-type': 'request/buffer',
                        ...initType ? { 'init-content-type': initType } : {}
                    } : encodeBody
                        ? { 'content-type': 'request/buffer', 'entity-encoded': '1' }
                        : {},
                    ...(!mtoken || uglified) ? {} : { mtoken }
                }
            });
            const { ok, type, status, statusText, redirected, url, headers, size } = f;
            const simple = headers.get('simple_error');

            if (!isLink && simple) throw { simpleError: JSON.parse(simple) };

            const buffer = uglified ?
                Buffer.from(await deserializeE2E(await f.arrayBuffer(), serverE2E_PublicKey, privateKey)) :
                Buffer.from(await f.arrayBuffer());

            const resObj = {
                buffer,
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

            if (shouldCache) insertFetchResources(projectUrl, reqId, resObj);

            finalize(buildFetchData(resObj));
        } catch (e) {
            let thisRecord;

            const getThisRecord = async () => thisRecord ? thisRecord[0]
                : (thisRecord = [await getFetchResources(projectUrl, reqId)])[0];

            if (e?.simpleError) {
                finalize(undefined, e.simpleError);
            } else if (
                (retrieval === RETRIEVAL.CACHE_NO_AWAIT && !(await getThisRecord())) ||
                retrieval === RETRIEVAL.STICKY_NO_AWAIT ||
                retrieval === RETRIEVAL.NO_CACHE_NO_AWAIT
            ) {
                finalize(undefined, simplifyCaughtError(e).simpleError);
            } else if (
                shouldCache &&
                [
                    RETRIEVAL.DEFAULT,
                    RETRIEVAL.CACHE_NO_AWAIT,
                    RETRIEVAL.CACHE_AWAIT
                ].includes(retrieval) &&
                await getThisRecord()
            ) {
                resolveCache(await getThisRecord());
            } else if (retries > maxRetries) {
                finalize(undefined, simplifyCaughtError(e).simpleError);
            } else {
                const listener = listenReachableServer(async online => {
                    if (online) {
                        listener();
                        callFetch().then(
                            e => finalize(e),
                            e => finalize(undefined, e)
                        );
                    }
                }, projectUrl);
            }
        }
    });

    return (await callFetch());
};