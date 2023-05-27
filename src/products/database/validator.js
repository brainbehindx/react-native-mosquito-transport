import { everyEntrie, IS_RAW_OBJECT, queryEntries } from "../../helpers/peripherals";
import _ from "lodash";

export const validateBuilder = () => {

}

export const validateReadOptions = () => {

}

export const validateReadConfig = (config) => {
    if (config) {
        if (!IS_RAW_OBJECT(config)) throw `Invalid value assigned to 'config', expected a raw object`;
        Object.keys(config).forEach(e => {
            if (e === 'excludeFields' || e === 'returnOnly') {
                if (typeof config[e] !== 'string' && !Array.isArray(config[e]))
                    throw `invalid value supplied to ${e}, expected either a string or array of string`;
            } else throw `unexpected property '${e}' found in config`;
        });
    }
}

const FOREIGN_DOC_PROPS = ['_id', 'collection', 'find'];

export const validateWriteValue = (value, filter, type) => {
    const isObject = IS_RAW_OBJECT(value);

    if (type === 'set') {
        (Array.isArray(value) ? value : [value]).forEach(e => {
            if (!IS_RAW_OBJECT(e)) throw `expected raw Object in mosquitodb ${type}() operation but got ${e}`;
            if (!value._id) throw 'No _id found in set() operation mosquitodb';
        });
        return;
    }

    if (type !== 'delete' && type !== 'deleteMany')
        if (!isObject) throw `expected raw Object in mosquitodb ${type}() operation but got ${value}`;

    validateFilter(filter);
    validateRawWriteValue(value);

    everyEntrie(value, ([key, value]) => {
        if (key === '_foreign_doc' || key === '_foreign_col') {
            const p = Array.isArray(value) ? value : [value];
            validateCollectionPath(p.collection);
            p.forEach(e => {
                Object.keys(e).forEach(e => {
                    if (!FOREIGN_DOC_PROPS.includes(e))
                        throw `Unknown props of "${e}" in "${key}" (mosquitodb)`;
                })
            });
            if (key === '_foreign_col') {
                validateFilter(f.find);
            } else validateDocumentId(p._id);
        }
    });
}

export const validateRawWriteValue = (value) => {

}

export const validateFilter = (filter = {}) => evaluateFilter({}, filter);

export const validateCollectionPath = (path) => {
    if (typeof path !== 'string' || path.includes('.') || !path.trim()) throw `invalid collection path "${path}", expected non-empty string and mustn't contain "."`;
}

export const validateDocumentId = (id) => {
    if (!id) throw `_id is required`;
};

export const confirmFilterDoc = (data, filter) => {
    const logics = [[], [], [], []];

    Object.entries(filter).forEach(([key, value]) => {
        if (key === '$and') {
            value.forEach(v => logics[0].push(evaluateFilter(data, v)));
        } else if (key === '$or') {
            value.forEach(v => logics[1].push(evaluateFilter(data, v)));
        } else logics[0].push(evaluateFilter(data, { [`${key}`]: value }));
    });

    return !logics[0].filter(v => !v).length && (!logics[1].length || !!logics[1].filter(v => v).length);
}

const TYPE_OPERATORS = ['number', 'string', 'array', 'bool', 'object', 'regex', 'null', 'decimal'];
const $TEXT_OPERATOR = ['$search', '$caseSensitive'];

const evaluateFilter = (data, filter = {}) => {
    const logics = [];

    Object.entries(filter).forEach(([key, value]) => {
        if (key.startsWith('$')) {
            throw `No query operator should be placed at the first level except ($or, $and, $not, $nor) at {${key}: ${value}}`;
        } else {
            if (IS_RAW_OBJECT(value)) {
                queryEntries(value, undefined, ['$text', '$timestamp']).forEach(([node, q]) => {
                    if (node.includes('$all')) {
                        if (node !== '$all') {
                            if (node.split('.$') >= 3) throw 'You must not provide additional operator for $all';
                            if (!node.endsWith('.$all')) throw '$all operator must be at the last level';
                        }
                        if (!Array.isArray(q)) throw 'The operator value of $all must be an array';

                        const d = `${key}${node === '$all' ? '' : '.' + node.split('.$all').join('')}`,
                            dv = _.get(data, d);

                        if (Array.isArray(dv)) {
                            logics.push(!q.filter(v => !dv.includes(v)).length);
                        } else logics.push(false);
                    } else if (node.includes('$in')) {
                        if (node !== '$in') {
                            if (node.split('.$') >= 3) throw 'You must not provide additional operator for $in';
                            if (!node.endsWith('.$in')) throw '$in operator must be at the last level';
                        }
                        if (!Array.isArray(q)) throw 'The operator value of $in must be an array';

                        const d = `${key}${node === '$in' ? '' : '.' + node.split('.$in').join('')}`,
                            dv = _.get(data, d);

                        if (Array.isArray(dv)) {
                            logics.push(!!q.filter(v => v instanceof RegExp ? testAll(dv, v) : dv.includes(v)).length);
                        } else logics.push(false);
                    } else if (node.includes('$nin')) {
                        if (node !== '$nin') {
                            if (node.split('.$') >= 3) throw 'You must not provide additional operator for $nin';
                            if (!node.endsWith('.$nin')) throw '$nin operator must be at the last level';
                        }
                        if (!Array.isArray(q)) throw 'The operator value of $nin must be an array';

                        const d = `${key}${node === '$nin' ? '' : '.' + node.split('.$nin').join('')}`,
                            dv = _.get(data, d);

                        if (Array.isArray(dv)) {
                            logics.push(!q.filter(v => v instanceof RegExp ? !testAll(dv, v) : !dv.includes(v)).length);
                        } else logics.push(false);
                    } else if (node.includes('$gt')) {
                        if (node !== '$gt') {
                            if (node.split('.$') >= 3) throw 'You must not provide additional operator for $gt';
                            if (!node.endsWith('.$gt')) throw '$gt operator must be at the last level';
                        }

                        const d = `${key}${node === '$gt' ? '' : '.' + node.split('.$gt').join('')}`,
                            dv = _.get(data, d);

                        if (typeof q === 'number') {
                            logics.push(typeof dv === 'number' && q > dv);
                        } else if (IS_TIMESTAMP(q)) {
                            logics.push(IS_TIMESTAMP(dv) && dv.$timestamp > (q.$timestamp === 'now' ? Date.now() : q.$timestamp));
                        } else throw 'Unknown type supplied to $gt, expected any of (number, string, Timestamp)';
                    } else if (node.includes('$gte')) {
                        if (node !== '$gte') {
                            if (node.split('.$') >= 3) throw 'You must not provide additional operator for $gte';
                            if (!node.endsWith('.$gte')) throw '$gte operator must be at the last level';
                        }

                        const d = `${key}${node === '$gte' ? '' : '.' + node.split('.$gte').join('')}`,
                            dv = _.get(data, d);

                        if (typeof q === 'number') {
                            logics.push(typeof dv === 'number' && q >= dv);
                        } else if (IS_TIMESTAMP(q)) {
                            logics.push(IS_TIMESTAMP(dv) && dv.$timestamp >= (q.$timestamp === 'now' ? Date.now() : q.$timestamp));
                        } else throw 'Unknown type supplied to $gte, expected any of (number, string, Timestamp)';
                    } else if (node.includes('$lt')) {
                        if (node !== '$lt') {
                            if (node.split('.$') >= 3) throw 'You must not provide additional operator for $lt';
                            if (!node.endsWith('.$lt')) throw '$lt operator must be at the last level';
                        }

                        const d = `${key}${node === '$lt' ? '' : '.' + node.split('.$lt').join('')}`,
                            dv = _.get(data, d);

                        if (typeof q === 'number') {
                            logics.push(typeof dv === 'number' && q < dv);
                        } else if (IS_TIMESTAMP(q)) {
                            logics.push(IS_TIMESTAMP(dv) && dv.$timestamp < (q.$timestamp === 'now' ? Date.now() : q.$timestamp));
                        } else throw 'Unknown type supplied to $lt, expected any of (number, string, Timestamp)';
                    } else if (node.includes('$lte')) {
                        if (node !== '$lte') {
                            if (node.split('.$') >= 3) throw 'You must not provide additional operator for $lte';
                            if (!node.endsWith('.$lte')) throw '$lte operator must be at the last level';
                        }

                        const d = `${key}${node === '$lte' ? '' : '.' + node.split('.$lte').join('')}`,
                            dv = _.get(data, d);

                        if (typeof q === 'number') {
                            logics.push(typeof dv === 'number' && q <= dv);
                        } else if (IS_TIMESTAMP(q)) {
                            logics.push(IS_TIMESTAMP(dv) && dv.$timestamp <= (q.$timestamp === 'now' ? Date.now() : q.$timestamp));
                        } else throw 'Unknown type supplied to $lte, expected any of (number, string, Timestamp)';
                    } else if (key === '$text') {
                        if (!IS_RAW_OBJECT(q)) throw `Expected an object for $text value`;
                        Object.entries(q).forEach(([k, v]) => {
                            if (k === '$search') {
                                if (typeof v !== 'string') throw `Invalid value type for $search, expected string but got ${typeof v}`;
                            } else if (k === '$caseSensitive') {
                                if (typeof v !== 'boolean') throw `Invalid value type for $caseSensitive, expected boolean but got ${typeof v}`;
                            } else throw `Invalid property "${k}", only expecting any of ${$TEXT_OPERATOR.join(', ')}`;
                        });
                        if (typeof q.$search !== 'string') throw `Invalid value supplied to $search, expected a string but got ${typeof q.$search}`;

                        const d = `${key}${node === '$text' ? '' : '.' + node.split('.$text').join('')}`,
                            dv = _.get(data, d),
                            s = q.$caseSensitive ? q.$search : q.$search.toLowerCase();

                        if (typeof dv === 'string') {
                            logics.push(
                                (q.$search.startsWith('"') && q.$search.endsWith('"'))
                                    ? dv.includes(s)
                                    : !!s.split(' ').filter(v => dv.includes(v)).length
                            );
                        } else logics.push(false);
                    } else if (node.includes('$eq')) {
                        if (node !== '$eq') {
                            if (node.split('.$') >= 3) throw `You must not provide additional operator for $eq`;
                            if (!node.endsWith('.$eq')) throw '$eq operator must be at the last level';
                        }
                        const d = `${key}${node === '$eq' ? '' : '.' + node.split('.$eq').join('')}`,
                            dv = _.get(data, d);

                        logics.push(q instanceof RegExp ? q.test(dv) : dv === q);
                    } else if (node.includes('$regex')) {
                        if (node !== '$regex') {
                            if (node.split('.$') >= 3) throw `You must not provide additional operator for $regex`;
                            if (!node.endsWith('.$regex')) throw '$regex operator must be at the last level';
                        }
                        const d = `${key}${node === '$regex' ? '' : '.' + node.split('.$regex').join('')}`,
                            dv = _.get(data, d);

                        if (!(q instanceof RegExp)) throw `$regex must have a regex value`;
                        logics.push(q.test(dv));
                    } else if (node.includes('$exists')) {
                        if (node !== '$exists') {
                            if (node.split('.$') >= 3) throw `You must not provide additional operator for $exists`;
                            if (!node.endsWith('.$exists')) throw '$exists operator must be at the last level';
                        }
                        const d = `${key}${node === '$exists' ? '' : '.' + node.split('.$exists').join('')}`,
                            dv = _.get(data, d);

                        logics.push(q ? dv !== undefined : dv === undefined);
                    } else if (node.includes('$type')) {
                        if (node !== '$type') {
                            if (node.split('.$') >= 3) throw `You must not provide additional operator for $type`;
                            if (!node.endsWith('$type')) throw '$type operator must be at the last level';
                        }

                        let isType = false;
                        const d = `${key}${node === '$type' ? '' : '.' + node.split('.$type').join('')}`,
                            dv = _.get(data, d),
                            cack = (q) => {
                                if (q === 'number') {
                                    if (!isType) isType = typeof dv === 'number';
                                } else if (q === 'bool') {
                                    if (!isType) isType = typeof dv === 'boolean';
                                } else if (q === 'string') {
                                    if (!isType) isType = typeof dv === 'string';
                                } else if (q === 'array') {
                                    if (!isType) isType = Array.isArray(dv);
                                } else if (q === 'null') {
                                    if (!isType) isType = dv === null;
                                } else if (q === 'regex') {
                                    if (!isType) isType = dv instanceof RegExp;
                                } else if (q === 'object') {
                                    if (!isType) isType = typeof dv === 'object';
                                } else if (q === 'decimal') {
                                    if (!isType) isType = typeof dv === 'number' && `${dv}`.includes('.');
                                } else throw `unknown value supplied to $type, supported type are (${TYPE_OPERATORS.join(', ')})`;
                            }

                        if (Array.isArray(q)) {
                            q.forEach(e => {
                                cack(e);
                            });
                        } else if (typeof q === 'string') {
                            cack(q);
                        } else throw `$type must either be a string or array`;

                        logics.push(isType);
                    } else if (node.includes('$ne')) {
                        if (node !== '$ne') {
                            if (node.split('.$') >= 3) throw `You must not provide additional operator for $ne`;
                            if (!node.endsWith('.$ne')) throw '$ne operator must be at the last level';
                        }
                        const d = `${key}${node === '$ne' ? '' : '.' + node.split('.$ne').join('')}`,
                            dv = _.get(data, d);

                        logics.push(q instanceof RegExp ? !q.test(dv) : dv !== q);
                    } else if (node.includes('$size')) {
                        if (node !== '$size') {
                            if (node.split('.$') >= 3) throw 'You must not provide additional operator for $size';
                            if (!node.endsWith('.$size')) throw '$size operator must be at the last level';
                        }
                        if (!IS_WHOLE_NUMBER(q)) throw 'The operator value of $size must be a whole number';

                        const d = `${key}${node === '$size' ? '' : '.' + node.split('.$size').join('')}`,
                            dv = _.get(data, d);

                        if (Array.isArray(dv)) {
                            logics.push(dv.length === q);
                        } else logics.push(false);
                    } else if (node.includes('$')) {
                        throw `Unknown query operator "${node}"`;
                    } else {
                        const d = `${key}.${node}`,
                            dv = _.get(data, d);

                        logics.push(q instanceof RegExp ? q.test(dv) : dv === q);
                    }
                });

            } else {
                if (value instanceof RegExp) {
                    logics.push(value.test(_.get(data, key)));
                } else logics.push(_.get(data, key) === value)
            }
        }
    });

    return !logics.filter(v => !v).length;
}