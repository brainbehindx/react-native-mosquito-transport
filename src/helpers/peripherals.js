import { ServerReachableListener } from "./listeners";

export const simplifyError = (error, message) => ({
    simpleError: { error, message }
});

export const simplifyCaughtError = (e) => e?.simpleError ? e : simplifyError('unexpected_error', `${e}`);

export const everyEntrie = (obj, callback) => {
    if (typeof obj !== 'object' || Array.isArray(obj)) return;
    oEntries(obj).forEach(e => {
        callback?.(e);
    });
}

export const flatEntries = (obj) => oEntries(obj);

export const flatRawEntries = () => oEntries(obj, false);

export const oEntries = (obj, includeObj = true) => {
    let o = [];

    Object.entries(obj).forEach(e => {
        o.push(e);
        if (typeof e[1] === 'object' && !Array.isArray(e[1])) {
            o = [...o, ...oEntries(e[1])];
        }
    });

    return o.filter(v => includeObj || typeof v[1] !== 'object' || Array.isArray(v[1]));
}

export const IS_RAW_OBJECT = (e) => typeof e === 'object' && !Array.isArray(e);

export const IS_WHOLE_NUMBER = (v) => typeof v === 'number' && !`${v}`.includes('.');

export const queryEntries = (obj, lastPath = '', exceptions = []) => {
    let o = [];

    Object.entries(obj).forEach(([key, value]) => {
        if (typeof value === 'object' && !Array.isArray(value) && !exceptions.includes(key)) {
            o = [...o, ...queryEntries(value, `${lastPath}${key}.`)];
        } else o.push([`${lastPath}${key}`, value]);
    });

    return o;
}

export const listenReachableServer = (callback, projectUrl) => ServerReachableListener.startKeyListener(projectUrl, t => {
    if (typeof t === 'boolean') callback?.(t);
}, true);

export const prefixStoragePath = (path, prefix = 'file:///') => {
    if (!path) return path;

    if (!path.startsWith('/') && !path.includes(':')) return prefix + path;

    return prefix + path.split('/').filter((v, i) => i && v).join('/');
}

export const getUrlExtension = (url) => {
    const r = url.split(/[#?]/)[0].split(".").pop().trim();
    return r === url ? '' : r;
}