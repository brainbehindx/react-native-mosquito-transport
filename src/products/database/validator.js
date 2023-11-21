import { IS_DECIMAL_NUMBER, IS_RAW_OBJECT, IS_WHOLE_NUMBER, queryEntries } from "../../helpers/peripherals";
import { READ_OPS, READ_OPS_LIST, RETRIEVAL } from "../../helpers/values";
import getLodash from 'lodash/get';
import isEqual from 'lodash/isEqual';

const dirn = ['desc', 'asc', 'ascending', 'descending'];

export const validateReadConfig = (config, excludedNodes = []) => {
    const nodeList = [
        'excludeFields',
        'returnOnly',
        'extraction',
        'episode',
        'retrieval',
        'disableAuth',
        'disableMinimizer'
    ].filter(v => !excludedNodes.includes(v));

    if (config) {
        if (!IS_RAW_OBJECT(config)) throw `Invalid value assigned to 'config', expected a raw object`;
        Object.entries(config).forEach(([k, v]) => {
            if (!nodeList.includes(k)) throw `unexpected property '${k}' found in config`;

            if (k === 'excludeFields' || k === 'returnOnly') {
                if (typeof v !== 'string' && !Array.isArray(v))
                    throw `invalid value supplied to ${k}, expected either a string or array of string`;
                if (Array.isArray(v)) {
                    v.forEach(e => {
                        if (typeof e !== 'string')
                            throw `invalid value supplied to ${k}, expected a string in array but got ${e}`;
                    });
                }
            } else if (k === 'extraction') {
                ((Array.isArray(v) ? v : [v]).forEach((e, i) => {
                    const { limit, sort, direction, collection, find, findOne } = e;
                    if (typeof limit === 'number' && (!IS_WHOLE_NUMBER(limit) || limit <= 0))
                        throw `invalid value supplied to limit of extraction[${i}], expected a positive whole number but got ${limit}`;

                    if (sort && typeof sort !== 'string')
                        throw `invalid value supplied to sort in extraction[${i}], expected a string value but got ${sort}`;

                    if (collection && typeof collection !== 'string')
                        throw `invalid value supplied to collection in extraction[${i}], expected a string value but got ${collection}`;

                    if (direction && direction !== 1 && direction !== -1 && !dirn.includes(direction))
                        throw `invalid value supplied to direction in extraction[${i}], expected any of ${[1, -1, ...dirn]} but got ${direction}`;
                }));
            } else if (k === 'episode') {
                if (v !== 0 && v !== 1) throw `invalid value supplied to ${k}, expected either 0 or 1 but got ${v}`;
            } else if (k === 'retrieval') {
                const h = Object.values(RETRIEVAL);
                if (!h.includes(v))
                    throw `invalid value supplied to ${k}, expected any of ${h} but got ${v}`;
            } else if (k === 'disableAuth' || k === 'disableMinimizer') {
                if (typeof v !== 'boolean')
                    throw `invalid value supplied to ${k}, expected a boolean value but got ${v}`;
            } else throw `unexpected property '${k}' found in config`;
        });
    }
}

export const validateWriteValue = (value, filter, type) => {
    const isObject = IS_RAW_OBJECT(value);

    if (type === 'setOne' || type === 'setMany') {
        if (type === 'setOne' && !isObject) {
            throw `expected raw object in ${type}() operation but got ${value}`;
        } else if (type === 'setMany' && !Array.isArray(value))
            throw `expected an array of document in ${type}() operation but got ${value}`;

        const duplicateID = {};

        (Array.isArray(value) ? value : [value]).forEach(e => {
            if (!IS_RAW_OBJECT(e)) throw `expected raw object in ${type}() operation but got ${e}`;
            if (duplicateID[e._id]) throw `duplicate document _id:${e._id} found in ${type}() operation`;
            if (!e._id) throw `No _id found in ${type}() operation`;
            duplicateID[e._id] = true;
        });
        return;
    }

    if (type !== 'deleteOne' && type !== 'deleteMany')
        if (!isObject) throw `expected raw object in ${type}() operation but got ${value}`;

    validateFilter(filter);

    queryEntries(value, []).forEach(([segment]) => {
        if (segment.filter(v => v === '_foreign_doc').length)
            throw `"_foreign_doc" is a reserved word, don't use it as a field in a document`;

        // TODO: validate rest
    });
}

export const validateFilter = (filter = {}) => evaluateFilter({}, filter);

export const validateCollectionPath = (path) => {
    if (typeof path !== 'string' || path.includes('.') || !path.trim())
        throw `invalid collection path "${path}", expected non-empty string and mustn't contain "."`;
}

export const confirmFilterDoc = (data, filter) => {
    // [$and, $or]
    const logics = [[], []];

    Object.entries(filter).forEach(([key, value]) => {
        if (key === '$and') {
            if (!Array.isArray(value)) throw `$and must be an array`;
            value.forEach(v => logics[0].push(evaluateFilter(data, v)));
        } else if (key === '$or') {
            if (!Array.isArray(value)) throw `$and must be an array`;
            value.forEach(v => logics[1].push(evaluateFilter(data, v)));
        } else logics[0].push(evaluateFilter(data, { [`${key}`]: value }));
    });

    return !logics[0].filter(v => !v).length && (!logics[1].length || !!logics[1].filter(v => v).length);
}

const dataTypesValue = [
    'double',
    'string',
    'object',
    'array',
    'decimal',
    // 'long',
    'int',
    'bool',
    'date',
    'null',
    'number'
];

const { $IN, $NIN, $GT, $GTE, $LT, $LTE, $EQ, $EXISTS, $REGEX, $NE, $SIZE, $TEXT, $TYPE } = READ_OPS;

// TODO: fix exact field value doc, deep nesting and other query

const evaluateFilter = (data = {}, filter = {}) => {
    if (!IS_RAW_OBJECT(data)) throw `data must be a raw object`;
    if (!IS_RAW_OBJECT(filter)) throw `expected a raw object but got ${filter}`;

    const dataObj = { ...data },
        logics = [];

    queryEntries(filter, []).forEach(([segment, value]) => {
        let commandSplit = segment.map((e, i) => e.startsWith('$') ? ({ $: e, i }) : null).filter(v => v);

        if (commandSplit.length) {
            const { $, i: dex } = commandSplit[0],
                pathValue = dex ? getLodash(dataObj, segment.filter((_, i) => i < dex).join('.')) : null;

            if (!READ_OPS_LIST.includes($))
                throw `"${$}" operation is currently not supported`;

            if ($ !== $TEXT && (dex !== segment.length - 1 || !dex))
                throw `"${$} must be at the last position as an operator"`;

            if ($ === $IN) {
                if (!Array.isArray(value)) throw `The value assigned to "${$}" operator must be an array`;

                if (pathValue !== undefined) {
                    logics.push(
                        !!(Array.isArray(pathValue) ? pathValue : [pathValue])
                            .filter(v => !!value.filter(t => checkTestEquality(t, v)).length).length
                    );
                } else logics.push(false);
            } else if ($ === $NIN) {
                if (!Array.isArray(value)) throw `The value assigned to "${$}" operator must be an array`;

                if (pathValue !== undefined) {
                    logics.push(
                        !(Array.isArray(pathValue) ? pathValue : [pathValue])
                            .filter(v => !!value.filter(t => checkTestEquality(t, v)).length).length
                    );
                } else logics.push(true);
            } else if ($ === $GT) {
                if (pathValue !== undefined) {
                    logics.push(
                        !!(Array.isArray(pathValue) ? pathValue : [pathValue])
                            .filter(v => v > value).length
                    );
                } else logics.push(false);
            } else if ($ === $GTE) {
                if (pathValue !== undefined) {
                    logics.push(
                        !!(Array.isArray(pathValue) ? pathValue : [pathValue])
                            .filter(v => v >= value).length
                    );
                } else logics.push(false);
            } else if ($ === $LT) {
                if (pathValue !== undefined) {
                    logics.push(
                        !!(Array.isArray(pathValue) ? pathValue : [pathValue])
                            .filter(v => v < value).length
                    );
                } else logics.push(false);
            } else if ($ === $LTE) {
                if (pathValue !== undefined) {
                    logics.push(
                        !!(Array.isArray(pathValue) ? pathValue : [pathValue])
                            .filter(v => v <= value).length
                    );
                } else logics.push(false);
            } else if ($ === $TEXT) {
                if (commandSplit.slice(-1)[0].$ === '$search') {
                    const { $caseSensitive, $localFields = [], $search } = dataObj.$text;

                    if (typeof value !== 'string' || typeof $search !== 'string')
                        throw `$search must have a string value`;

                    const searchTxt = $localFields.map(v => getLodash(dataObj, v || '')).map(v =>
                        `${typeof v === 'string' ? v :
                            Array.isArray(v) ? v.map(v => typeof v === 'string' ? v : '').join(' ').trim() : ''}`.trim()
                    ).join(' ').trim();

                    logics.push(
                        $caseSensitive ? searchTxt.includes(value.trim()) :
                            searchTxt.toLowerCase().includes(value.toLowerCase().trim())
                    );
                }
            } else if ($ === $EQ) {

            } else if ($ === $EXISTS) {

            } else if ($ === $REGEX) {

            } else if ($ === $NE) {

            } else if ($ === $SIZE) {
                if (!IS_WHOLE_NUMBER(value) || v < 0) throw '$size must be a positive whole number';
                logics.push(Array.isArray(pathValue) && pathValue.length === value);
            } else if ($ === $TYPE) {
                if (!dataTypesValue.includes(value))
                    throw `invalid value supplied to ${$}, mosquitodb only recognise "${dataTypesValue}" data types`;

                const cock = (v) => {
                    if (typeof v === 'number') {
                        if (isNaN(v)) {
                            return ((value === 'decimal' || value === 'double') && IS_DECIMAL_NUMBER(v)) || value === 'int' || value === 'number';
                        }
                    } else if (typeof v === 'boolean') {
                        return value === 'bool';
                    } else if (typeof v === 'string') {
                        return value === 'string';
                    } else if (v === null) {
                        return value === 'null';
                    } else if (v instanceof RegExp) {
                        return value === 'regex';
                    } else if (v instanceof Date) {
                        return value === 'date';
                    } else if (IS_RAW_OBJECT(v)) {
                        return value === 'object';
                    }
                    return false;
                }

                logics.push(
                    (Array.isArray(pathValue) && value === 'array') ||
                    !!(Array.isArray(pathValue) ? pathValue : [pathValue])
                        .filter(v => cock(v)).length
                );
            }
        } else {
            const pathValue = getLodash(dataObj, segment.join('.'));

            if (pathValue !== undefined) {
                logics.push(
                    !!(Array.isArray(pathValue) ? pathValue : [pathValue])
                        .filter(v => !!checkTestEquality(value, v)).length
                );
            } else logics.push(false);
        }
    });

    return !logics.filter(v => !v).length;
}

const checkTestEquality = (test, o) => {
    if (test instanceof RegExp) {
        if (typeof o === 'string') return test.test(o);
        else return false;
    } else return isEqual(test, o);
}