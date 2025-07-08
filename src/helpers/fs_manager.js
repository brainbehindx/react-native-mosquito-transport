import { Scoped } from "./variables";
import { Platform } from "react-native";
import { Dirs, FileSystem } from "react-native-file-access";

const PARENT_FOLDER = `${Platform.OS === 'android' ? Dirs.DocumentDir.split('/').slice(0, -1).join('/') : Dirs.MainBundleDir}/mosquito_base`;

/**
 * this method linearize read/write for individual access_id on the file system ensuring consistency across concurrent operations
 * 
 * @param {any} builder 
 * @param {string} access_id 
 * @param {string} node 
 * @returns {(task: (system: { set: (table: string, primary_key: string, value: {}) => Promise<void>, delete: (table: string, primary_key: string) => Promise<void>, find: (table: string, primary_key: string, extractions: string[]) => Promise<{}>, list: (table: string, extractions: string[]) => Promise<[string, {}][]> }) => any) => Promise<any>}
 */
export const useFS = (builder, access_id, node) => async (task) => {
    const { projectUrl, dbUrl, dbName } = builder;
    const nodeId = typeof builder === 'string' ? `${builder}_${access_id}` : `${projectUrl}_${dbUrl}_${dbName}_${access_id}`;

    const thatProcess = Scoped.linearFsProcess[node][nodeId];

    const thisPromise = new Promise(async (resolve, reject) => {
        try {
            if (thatProcess !== undefined) await thatProcess;
        } catch (_) { }
        try {
            resolve(await task(getSystem(builder)));
        } catch (error) {
            console.error('useFS err:', error, ' builder:', builder);
            reject(error);
        } finally {
            if (Scoped.linearFsProcess[node][nodeId] === thisPromise)
                delete Scoped.linearFsProcess[node][nodeId];
        }
    });

    Scoped.linearFsProcess[node][nodeId] = thisPromise;
    return (await thisPromise);
};

export const getSystem = (builder) => {
    const { projectUrl, dbUrl, dbName } = builder;

    const DIR_PATH = joinPath(PARENT_FOLDER, purifyFilepath(typeof builder === 'string' ? builder : `${projectUrl}_${dbUrl}_${dbName}`));
    const conjoin = (...args) => joinPath(DIR_PATH, ...args);

    return {
        set: async (table, primary_key, value) => {
            const path = conjoin(table, primary_key);
            await FileSystem.mkdir(path).catch(() => null);
            await Promise.all(Object.entries(value).map(([k, v]) =>
                FileSystem.writeFile(joinPath(path, k), JSON.stringify(v), 'utf8')
            ));
        },
        delete: (table, primary_key) => FileSystem.unlink(conjoin(table, primary_key)),
        find: async (table, primary_key, extractions) => {
            const path = conjoin(table, primary_key);

            const value_map = await Promise.all(extractions.map(async node =>
                [node, JSON.parse(await FileSystem.readFile(joinPath(path, node), 'utf8'))]
            ));
            return Object.fromEntries(value_map);
        },
        list: async (table, extractions) => {
            const names = await FileSystem.ls(conjoin(table));
            const list_data = await Promise.all(names.map(async primary_key => {
                const obj = await getSystem(builder).find(table, primary_key, extractions)
                    .catch(() => null);
                if (!obj) return;
                return [primary_key, obj];
            }));

            return list_data.filter(v => v);
        }
    };
};

export function purifyFilepath(filename) {
    if (!filename || typeof filename !== 'string')
        throw `invalid filename:${filename}`;

    // Remove invalid characters for both iOS and Android
    return filename
        .replace(/[/\\?%*:|"<>]/g, '') // Remove forbidden characters
        .trim(); // Remove leading/trailing whitespace
}

function joinPath(...args) {
    return args.map((v, i) => {
        if (i && v.startsWith('/'))
            v = v.slice(1);
        if (v.endsWith('/'))
            v = v.slice(0, -1);
        return v;
    }).join('/');
}

export const FS_PATH = {
    FILE_NAME: 'MOSQUITO_TRANSPORT',
    TABLE_NAME: 'MT_MAIN',
    LIMITER_RESULT: path => `${purifyFilepath(encodeURIComponent(path))}_LR`,
    LIMITER_DATA: path => `${purifyFilepath(encodeURIComponent(path))}_LD`,
    DB_COUNT_QUERY: path => `${purifyFilepath(encodeURIComponent(path))}_QC`,
    FETCH_RESOURCES: projectUrl => `FR_${purifyFilepath(encodeURIComponent(projectUrl))}`
};