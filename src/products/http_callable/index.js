import { IS_WHOLE_NUMBER, listenReachableServer, simplifyCaughtError } from "../../helpers/peripherals";
import { Scoped } from "../../helpers/variables";
import { awaitRefreshToken } from "../auth/accessor";

export const mfetch = async (input, init, config) => {
    const { projectUrl, maxRetries = 7, apiUrl } = config,
        disableAuth = init?.disableAuth;

    if (init?.retries && (!IS_WHOLE_NUMBER(init?.retries) || init?.retries < 0))
        throw 'retries must be a positive whole number';

    if (init?.headers?.mtoken)
        throw 'mtoken in header is a reserved prop';

    let retries = init?.retries || maxRetries;

    const callFetch = () => new Promise(async (resolve, reject) => {
        try {
            if (!disableAuth) await awaitRefreshToken(projectUrl);
            const f = await fetch(`${apiUrl}/${input}`, {
                cache: 'reload',
                ...init,
                headers: {
                    ...init?.headers,
                    ...(!disableAuth ? { mtoken: Scoped.AuthJWTToken[projectUrl] } : {})
                }
            }),
                simple = f.headers.get('simple_error');

            if (simple) throw { simpleError: JSON.parse(simple) };
            resolve(f);
        } catch (e) {
            if (e?.simpleError) {
                reject(e.simpleError);
            } else if (!retries--) {
                reject(simplifyCaughtError(e).simpleError);
            } else {
                const listener = listenReachableServer(async online => {
                    if (online) {
                        listener();
                        callFetch().then(resolve, reject);
                    }
                }, projectUrl);
            }
        }
    });

    const r = await callFetch();
    return r;
};