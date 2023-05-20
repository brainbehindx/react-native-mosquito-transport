import { addEventListener } from "@react-native-community/netinfo";

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

export const listenConnection = (callback) => {
    return addEventListener(s => {
        callback(s.isInternetReachable);
    });
}

export const prefixStoragePath = (path, prefix = 'file:///') => {
    if (!path) return path;

    if (!path.startsWith('/') && !path.includes(':')) return prefix + path;

    return prefix + path.split('/').filter((v, i) => i && v).join('/');
}

export const getUrlExtension = (url) => {
    const r = url.split(/[#?]/)[0].split(".").pop().trim();
    return r === url ? '' : r;
}

export const getMediaType = (value) => {
    let extension = (value || '').toLowerCase().split('.').pop(),
        result = '';

    if (extension) {
        extension = `.${extension}`.toLowerCase();

        const audios = '.3g2 .3gp .aac .adt .adts .aif .aifc .aiff .asf .au .m3u .m4a .m4b .mid .midi .mp2 .mp3 .mp4 .rmi .snd .wav .wax .wma'.split(' '),
            images = '.jpeg .jpg .png'.split(' '),
            videos = '.mp4';

        if (images.includes(extension)) result = extension === '.png' ? 'image/png' : 'image/jpeg';
        else if (videos === extension) result = 'video/mp4';
        else if (audios.includes(extension)) result = `audio/${extension.split('.').join('')}`;
        else if (extension === '.pdf') result = 'application/pdf';
        else if (extension === '.xls') result = 'application/vnd.ms-excel';
        else if (extension === '.xlsx') result = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        else if (extension === '.doc') result = 'application/msword';
        else if (extension === '.docx') result = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        else if (extension === '.ppt') result = 'application/vnd.ms-powerpoint';
        else if (extension === '.pptx') result = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        else if (extension === '.zip') result = 'application/zip';
        else if (extension === '.txt') result = 'text/plain';
    }

    return result;
}

const IS_ONLINE = () => Scoped.IS_CONNECTED;