import { IS_RAW_OBJECT, objToUniqueString, queryEntries, shuffleArray, sortArrayByObjectKey } from "../../helpers/peripherals";
import { awaitStore, updateCacheStore } from "../../helpers/utils";
import { CacheStore } from "../../helpers/variables";
import { confirmFilterDoc } from "./validator";
import getLodash from 'lodash/get';
import setLodash from 'lodash/set';
import unsetLodash from 'lodash/unset';
import isEqual from 'lodash/isEqual';
import { DEFAULT_DB_NAME, DEFAULT_DB_URL, DELIVERY, RETRIEVAL, WRITE_OPS, WRITE_OPS_LIST } from "../../helpers/values";
import { DatabaseRecordsListener } from "../../helpers/listeners";

export const listenQueryEntry = (callback, { accessId, builder, config, processId }) => {
    let lastObj = '';
    const { episode = 0 } = config || {};

    const l = DatabaseRecordsListener.listenTo(accessId, async (dispatchId) => {
        const cache = await getRecord(builder, accessId);
        if (
            cache &&
            !isEqual(lastObj, cache[episode]) &&
            dispatchId === processId
        ) callback(cache[episode]);
        lastObj = cache[episode];
    });

    return () => {
        lastObj = undefined;
        l();
    }
}

export const insertRecord = async (builder, accessId, query, value) => {
    await awaitStore();
    const { projectUrl, dbUrl = DEFAULT_DB_URL, dbName = DEFAULT_DB_NAME, path } = builder,
        { extraction, excludeFields, returnOnly } = query?.config,
        kaf = `${objToUniqueString(extraction || {})},${(excludeFields || []).join(',')},${(returnOnly || []).join(',')}`,
        colData = getLodash(CacheStore.DatabaseStore, [projectUrl, dbUrl, dbName, path, 'data', kaf], []);

    (Array.isArray(value) ? value : [value]).forEach(e => {
        const b4DocIndex = colData.findIndex(v => v._id === e._id);
        if (b4DocIndex === -1) {
            colData.push(e);
        } else colData[b4DocIndex] = e;
    });

    setLodash(CacheStore.DatabaseStore, [projectUrl, dbUrl, dbName, path, 'data', kaf], [...colData]);
    setLodash(CacheStore.DatabaseStore, [projectUrl, dbUrl, dbName, path, 'record', accessId], {
        query,
        result: value,
        registeredOn: Date.now()
    });
    updateCacheStore();
}

export const getRecord = async (builder, accessId) => {
    await awaitStore();
    const { projectUrl, dbUrl = DEFAULT_DB_URL, dbName = DEFAULT_DB_NAME, path, command } = builder,
        { config, find, findOne, sort, direction, limit, random } = command,
        { extraction, excludeFields, returnOnly } = config || {},
        kaf = `${objToUniqueString(extraction || {})},${(excludeFields || []).join(',')},${(returnOnly || []).join(',')}`,
        colData = getLodash(CacheStore.DatabaseStore, [projectUrl, dbUrl, dbName, path, 'data', kaf], []),
        colRecord = getLodash(CacheStore.DatabaseStore, [projectUrl, dbUrl, dbName, path, 'record', accessId]);

    if (!colRecord) return null;
    let choosenColData = colData.filter(v => confirmFilterDoc(v, findOne || find || {}));

    if (random) {
        choosenColData = shuffleArray(choosenColData);
    } else if (sort) {
        choosenColData = sortArrayByObjectKey(choosenColData, sort);
        if (
            direction === -1 ||
            direction === 'desc' ||
            direction === 'descending'
        ) choosenColData = choosenColData.reverse();
    }

    if (findOne) {
        choosenColData = choosenColData[0];
    } else if (limit) choosenColData.filter((_, i) => i < limit);

    return [choosenColData, colRecord.result];
}

export const generateRecordID = (builder, config) => {
    const { command, path, countDoc } = builder,
        { find, findOne, sort, direction, limit } = command || {},
        { extraction, retrieval = RETRIEVAL.DEFAULT, delivery = DELIVERY.DEFAULT, excludeFields = [], returnOnly = [] } = config || {},
        accessId = `collection:${path}->excludes:${(Array.isArray(excludeFields) ? excludeFields : [excludeFields]).filter(v => v !== undefined).join(',')}->includes:${(Array.isArray(returnOnly) ? returnOnly : [returnOnly]).filter(v => v !== undefined).join(',')}->${countDoc ? 'countDoc:yes->' : ''}sort:${sort || ''}->direction:${direction || ''}->limit:${limit || ''}->${findOne ? 'findOne' : 'find'}:${objToUniqueString(findOne || find || {})}:extraction:${objToUniqueString(extraction || {})}:retrieval:${retrieval}:delivery:${delivery}`;

    return accessId;
}

export const addPendingWrites = async (builder, writeId, result) => {
    await awaitStore();
    const { projectUrl, dbUrl = DEFAULT_DB_URL, dbName = DEFAULT_DB_NAME, path } = builder,
        { value: writeObj, find, type } = result,
        isAtomic = type === 'updateOne' ||
            type === 'updateMany' ||
            type === 'mergeOne' ||
            type === 'mergeMany',
        colObj = getLodash(CacheStore.DatabaseStore, [projectUrl, dbUrl, dbName, path, 'data'], {});

    let editions = [], duplicateSets = {};

    Object.entries(colObj).forEach(([kaf, colList]) => {
        let hasEndCommit, editionSet = [];

        if (type === 'setOne' || type === 'setMany') {
            (type === 'setOne' ? [writeObj] : writeObj).forEach(e => {
                if (colList.findIndex(v => v._id === e._id) === -1) {
                    editionSet.push({ doc: deserializeNonAtomicWrite(e), dex: 'push', docId: writeObj._id });
                } else if (!duplicateSets[e._id])
                    console.error(`document with _id=${e._id} already exist locally with ${type}() operation, will try committing it online`);
                duplicateSets[e._id] = true;
            });
        } else {
            colList.forEach((doc, docDex) => {
                if (hasEndCommit) return;
                let afDoc = undefined;

                if (confirmFilterDoc(doc, find || {})) {
                    if (type === 'deleteMany') {
                        afDoc = null;
                    } else if (type === 'deleteOne') {
                        afDoc = null;
                        hasEndCommit = true;
                    } else if (isAtomic) {
                        if ((deserializeAtomicWrite({}, { ...writeObj })?._id || find?._id) && type.endsWith('Many'))
                            throw `avoid providing "_id" for ${type}() operation, use ${type.substring(0, type.length - 4)}One instead as _id only reference a single document`;

                        afDoc = deserializeAtomicWrite({ ...doc }, { ...writeObj });
                        if (type.endsWith('One')) hasEndCommit = true;
                    } else {
                        afDoc = deserializeNonAtomicWrite({ ...writeObj });
                        hasEndCommit = true;
                    }
                }
                if (afDoc !== undefined)
                    editionSet.push({ doc: afDoc, dex: docDex, docId: doc._id, b4Doc: { ...doc } });
            });
        }

        if (!editionSet.length) {
            let hasNoID;

            if (type === 'putOne') {
                const nDoc = deserializeNonAtomicWrite(writeObj),
                    nId = nDoc?._id || find?._id;

                if (nId) {
                    editionSet.push({
                        doc: { ...nDoc, _id: nId },
                        dex: 'push',
                        docId: nId
                    });
                } else hasNoID = true;
            } else if (type === 'mergeOne' || type === 'mergeMany') {
                const nDoc = deserializeAtomicWrite({}, writeObj),
                    nId = nDoc?._id || find?._id;

                if (nId && type === 'mergeMany')
                    throw `avoid providing "_id" for mergeMany() operation, use mergeOne instead as _id only reference a single document`;
                if (nId) {
                    editionSet.push({
                        doc: { ...nDoc, _id: nId },
                        dex: 'push',
                        docId: nId
                    });
                } else hasNoID = true;
            }
            if (hasNoID) console.error(`no data found locally and _id was not provided for ${type}() operation, skipping local and proceeding to online commit`);
        }
        editions.push([kaf, editionSet]);
    });

    editions.forEach(([kaf, list]) => {
        list.forEach(({ doc, dex, docId }) => {

            if (dex === 'push') {
                colObj[kaf].push({ ...doc });
            } else if (doc === null) {
                colObj[kaf] = colObj[kaf].filter(v => v._id !== docId);
            } else {
                colObj[kaf] = colObj[kaf].map(v => v._id === docId ? { ...doc } : v);
            }
        });
    });


    setLodash(CacheStore.PendingWrites, [projectUrl, `${dbUrl}${dbName}${path}`, writeId], {
        find,
        value: writeObj,
        type,
        editions,
        addedOn: Date.now()
    });

    updateCacheStore();
    notifyDatabaseNodeChanges(builder);
}

export const removePendingWrite = async (builder, writeId, revert) => {
    await awaitStore();
    const { projectUrl, dbUrl = DEFAULT_DB_URL, dbName = DEFAULT_DB_NAME, path } = builder,
        pObj = getLodash(CacheStore.PendingWrites, [projectUrl, `${dbUrl}${dbName}${path}`, writeId]),
        colObj = getLodash(CacheStore.DatabaseStore, [projectUrl, dbUrl, dbName, path, 'data']);

    if (!pObj) return;

    if (revert && colObj)
        pObj.editions.forEach(([kaf, list]) => {
            list.forEach(({ doc, dex, docId, b4Doc }) => {

                if (dex === 'push') {
                    colObj[kaf] = colObj[kaf].filter(v => v._id !== docId);
                } else if (doc === null) {
                    colObj[kaf] = [...colObj[kaf], b4Doc];
                } else {
                    colObj[kaf] = colObj[kaf].map(v => v._id === docId ? { ...b4Doc } : v);
                }
            });
        });

    unsetLodash(CacheStore.PendingWrites, [projectUrl, `${dbUrl}${dbName}${path}`, writeId]);
    updateCacheStore();
    notifyDatabaseNodeChanges(builder);
}

export const trySendPendingWrite = () => {

}

const notifyDatabaseNodeChanges = (builder) => {

}

const deserializeNonAtomicWrite = (writeObj) => {
    const bj = {};

    queryEntries(writeObj, []).forEach(([segment, value]) => {
        if (segment[0].startsWith('$'))
            throw `unexpected field "${segment[0]}"`;

        if (segment.slice(-1)[0] === '$timestamp' && value === 'now') {
            segment.pop();
            value = Date.now();
        }

        setLodash(bj, segment.join('.'), value);
    });
    return bj;
}

const deserializeAtomicWrite = (b4Doc, writeObj) => {
    const afDoc = { ...b4Doc },
        affectedObj = {};

    queryEntries(writeObj, []).forEach(([segment, value]) => {
        const [op, path] = [segment[0], segment.filter((_, i) => i)];

        if (!WRITE_OPS_LIST.includes(op) || !path.length)
            throw `MongoInvalidArgumentError: Update document requires atomic operators`;

        if (
            path.length > 1 &&
            IS_RAW_OBJECT(writeObj[op][path[0]]) &&
            !affectedObj[path[0]]
        ) {
            affectedObj[path[0]] = true;
            afDoc[path[0]] = {};
        }

        const nodeValue = getLodash(b4Doc, path.join('.'));

        if (op === WRITE_OPS.$UNSET) {
            unsetLodash(afDoc, path.join('.'));
        } else {
            if (
                [WRITE_OPS.$MAX, WRITE_OPS.$MIN, WRITE_OPS.$INC, WRITE_OPS.$MUL].filter(v => v === op).length &&
                isNaN(value)
            ) throw `expected a number for "${op}" operation but got ${value}`;

            if (path.slice(-1)[0] === '$timestamp' && value === 'now') {
                const k = [WRITE_OPS.$SET, WRITE_OPS.$UNSET];
                if (!k.includes(op))
                    throw `invalid operator for updating timestamp, expected any of ${k}`;
                path.pop();
                value = Date.now();
            }

            if (op === WRITE_OPS.$RENAME) {
                if (nodeValue === undefined) return;
                if (typeof value !== 'string') throw `${op} operator expected a string value at ${path.join('.')}`;
                unsetLodash(afDoc, path.join('.'));
                path[path.length - 1] = value;
            }

            setLodash(
                afDoc,
                path.join('.'),
                op === WRITE_OPS.$SET ? value :
                    op === WRITE_OPS.$INC ? (isNaN(nodeValue) ? value : nodeValue + value) :
                        op === WRITE_OPS.$MAX ? (isNaN(nodeValue) ? value : value > nodeValue ? value : nodeValue) :
                            op === WRITE_OPS.$MIN ? (isNaN(nodeValue) ? value : value < nodeValue ? value : nodeValue) :
                                op === WRITE_OPS.$MUL ? (isNaN(nodeValue) ? 0 : value * nodeValue) :
                                    op === WRITE_OPS.$PULL ? (Array.isArray(nodeValue) ? nodeValue.filter(v => !isEqual(v, value)) : [value]) :
                                        op === WRITE_OPS.$PUSH ? (Array.isArray(nodeValue) ? [...nodeValue, value] : [value]) :
                                            op === WRITE_OPS.$RENAME ? nodeValue :
                                                null // TODO:
            );
        }
    });

    return afDoc;
}