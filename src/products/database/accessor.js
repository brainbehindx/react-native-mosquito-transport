import _ from "lodash";
import { IS_RAW_OBJECT, IS_WHOLE_NUMBER, queryEntries } from "../../helpers/peripherals";
import { awaitStore, updateCacheStore } from "../../helpers/utils";
import { CacheStore, Scoped } from "../../helpers/variables";
import { IS_TIMESTAMP } from "./types";
import { confirmFilterDoc } from "./validator";

export const insertRecord = async (projectUrl, dbUrl, dbName, accessId) => {
    await awaitStore();
    if (!CacheStore.DatabaseRecords[projectUrl])
        CacheStore.DatabaseRecords[projectUrl] = {};

    if (!CacheStore.DatabaseRecords[projectUrl][dbUrl])
        CacheStore.DatabaseRecords[projectUrl][dbUrl] = {};

    if (!CacheStore.DatabaseRecords[projectUrl][dbUrl][dbName])
        CacheStore.DatabaseRecords[projectUrl][dbUrl][dbName] = {};

    CacheStore.DatabaseRecords[projectUrl][dbUrl][dbName][accessId] = true;
    updateCacheStore();
}

export const deleteRecord = async (projectUrl, dbUrl, dbName, accessId) => {
    await awaitStore();
    if (CacheStore.DatabaseRecords[projectUrl]?.[dbUrl]?.[dbName]?.[accessId])
        delete CacheStore.DatabaseRecords[projectUrl][dbUrl][dbName][accessId];
    updateCacheStore();
}

export const getRecord = async (projectUrl, dbUrl, dbName, accessId) => {
    await awaitStore();
    return CacheStore.DatabaseRecords[projectUrl]?.[dbUrl]?.[dbName]?.[accessId];
}

export const transformCollectionPath = (path = '') => `${path.split('/').join('.')}.$$collection$$`;

// TODO: fix segment hint(returnOnly, excludeField)
export const updateDatabaseStore = async (projectUrl, dbUrl, dbName, path, dataMap, segment) => {
    await awaitStore();
    prepareDatabaseStore(projectUrl, dbUrl, dbName);

    const node = transformCollectionPath(path),
        db = `${dbUrl}${dbName}`,
        instantData = _.get(CacheStore.DatabaseStore[projectUrl][db], node);

    if (!instantData) _.set(CacheStore.DatabaseStore[projectUrl][db], node, []);

    (Array.isArray(dataMap) ? dataMap : [dataMap]).forEach(e => {
        if (!e._id) throw `No _id found in updateDatabaseStore(), collection(${path})`;
        const store = _.get(CacheStore.DatabaseStore[projectUrl][db], node) || [],
            cursor = store.findIndex(v => v._id === e._id),
            isDeletion = !e.value;

        if (cursor === -1) {
            if (!isDeletion) _.set(CacheStore.DatabaseStore[projectUrl][db], node, [...store, { ...e.value }]);
        } else {
            if (isDeletion) {
                _.set(CacheStore.DatabaseStore[projectUrl][db], node, store.filter((v, i) => i !== cursor));
            } else _.set(CacheStore.DatabaseStore[projectUrl][db], node, store.map((v, i) => i === cursor ? ({ ...e.value }) : v));
        }
    });

    updateCacheStore();
}

export const prepareDatabaseStore = (projectUrl, dbUrl, dbName) => {
    if (!CacheStore.DatabaseStore[projectUrl])
        CacheStore.DatabaseStore[projectUrl] = {};

    const db = `${dbUrl}${dbName}`;

    if (!CacheStore.DatabaseStore[projectUrl][db])
        CacheStore.DatabaseStore[projectUrl][db] = {};
}

export const accessData = async (projectUrl, dbUrl, dbName, path = '', find, segment) => {
    await awaitStore();
    prepareDatabaseStore(projectUrl, dbUrl, dbName);

    const d = _.get(CacheStore.DatabaseStore[projectUrl][db], transformCollectionPath(path)) || [],
        output = d.filter(v => confirmFilterDoc(v, find));

    return output;
}

export const addPendingWrites = async (projectUrl, dbUrl, dbName, writeId, value) => {
    await awaitStore();

    if (!CacheStore.PendingWrites[projectUrl])
        CacheStore.PendingWrites[projectUrl] = {};

    const db = `${dbUrl}${dbName}`;

    if (!CacheStore.PendingWrites[projectUrl][db])
        CacheStore.PendingWrites[projectUrl][db] = {};

    CacheStore.PendingWrites[projectUrl][db][`${writeId}`] = { ...value };
    updateCacheStore();
}

export const removePendingWrite = async (projectUrl, dbUrl, dbName, writeId) => {
    await awaitStore();
    if (CacheStore.PendingWrites[projectUrl]?.[`${dbUrl}${dbName}`]?.[`${writeId}`])
        delete CacheStore.PendingWrites[projectUrl][`${dbUrl}${dbName}`][`${writeId}`];
    updateCacheStore();
}

export const commitStore = async (projectUrl, dbUrl, dbName, path = '', value, filter, type = '') => {
    if (type.startsWith('set')) {
        (Array.isArray(value) ? value : [value]).forEach(e => {
            if (!IS_RAW_OBJECT(e)) throw 'Expected a raw object value on set() operation';
            if (!e._id) throw 'No _id found in set() operation mosquitodb';
            updateDatabaseStore(projectUrl, dbUrl, dbName, path, { _id: e._id, value: deserializeData(e, undefined, type) });
        });
    } else {
        if (value?._id) throw `You cannot change _id with ${type}() operation`;
        if (type.startsWith('delete')) {
            if (!!value) throw `Expected null or undefined on ${type}() operation`;
        } else if (!IS_RAW_OBJECT(value)) throw `Expected a raw object value on ${type}() operation`;

        const q = await accessData(projectUrl, dbUrl, dbName, path, filter);

        if (type.endsWith('Many') || q.length === 1)
            q.forEach(e => {
                updateDatabaseStore(
                    projectUrl,
                    dbUrl,
                    dbName,
                    path,
                    { _id: e._id, value: deserializeData(value, e, type) },
                );
            });
    }
}

const deserializeData = (data, b4Data, type = '') => {
    if (!data) return null;

    const result = { ...((type.startsWith('update') || type.startsWith('merge')) ? b4Data : {}), ...data };

    queryEntries(data, undefined).forEach(([key, value]) => {
        if (key.endsWith('$timestamp')) {
            _.set(result, key.split('.').filter((_, i, a) => i !== a.length).join('.'), { $timestamp: value === 'now' ? Date.now() : value });
        } else if (key.endsWith('$increment')) {
            if (type.startsWith('set')) throw `Cannot use field value INCREMENT() on set() operation`;
            const path = key.split('.').filter((_, i, a) => i !== a.length).join('.');
            if (b4Data) _.set(result, path, (_.get(b4Data, path) || 0) + value);
        } else if (key.endsWith('$deletion')) {
            const path = key.split('.').filter((_, i, a) => i !== a.length).join('.');
            if (b4Data && _.get(b4Data, path)) _.unset(result, path);
        } else _.set(result, key, value);
    });

    return result;
}

export const breakFilter = () => {

}

const testAll = (arr = [], test) => !!arr.filter(v => typeof v === 'string' && test.test(v)).length;