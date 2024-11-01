import { guardArray, GuardError, guardObject, GuardSignal, niceGuard, Validator } from "guard-object";
import { sameInstance } from "../../helpers/peripherals";
import { RETRIEVAL } from "../../helpers/values";
import getLodash from 'lodash.get';
import { Binary, BSONRegExp, BSONSymbol, Code, DBRef, Decimal128, Double, Int32, Long, MaxKey, MinKey, ObjectId, Timestamp, UUID } from 'bson';
import { bboxPolygon, booleanIntersects, booleanWithin, circle, distance, polygon } from "@turf/turf";

const DirectionList = [1, -1, 'asc', 'desc', 'ascending', 'descending'];
const FilterFootPrint = t => validateFilter(t);
const ReturnAndExcludeFootprint = t => t === undefined ||
    !(Array.isArray(t) ? t : [t]).filter(v => !Validator.TRIMMED_NON_EMPTY_STRING(v)).length;

const FindConfig = {
    extraction: t => t === undefined ||
        (Array.isArray(t) ? t : [t]).filter(m =>
            guardObject({
                collection: isValidCollectionName,
                sort: (t, p) => t === undefined || (Validator.TRIMMED_NON_EMPTY_STRING(t) && p.find),
                direction: (t, p) => t === undefined || (p.sort && p.find && DirectionList.includes(t)),
                limit: (t, p) => t === undefined || (Validator.POSITIVE_INTEGER(t) && p.find),
                find: (t, p) => (t === undefined && p.findOne) || (!p.findOne && FilterFootPrint(t)),
                findOne: (t, p) => (t === undefined && p.find) || (!p.find && FilterFootPrint(t)),
                returnOnly: ReturnAndExcludeFootprint,
                excludeFields: ReturnAndExcludeFootprint
            }).validate(m)
        ).length,
    returnOnly: ReturnAndExcludeFootprint,
    excludeFields: ReturnAndExcludeFootprint,

    episode: t => [undefined, 0, 1].includes(t),
    retrieval: t => t === undefined || Object.values(RETRIEVAL).includes(t),
    disableAuth: t => t === undefined || typeof t === 'boolean',
    disableMinimizer: t => t === undefined || typeof t === 'boolean'
};

export const validateFindConfig = (config) => config === undefined ||
    guardObject(FindConfig).validate(config);

export const validateListenFindConfig = (config) => config === undefined ||
    guardObject({
        extraction: FindConfig.extraction,
        returnOnly: FindConfig.returnOnly,
        excludeFields: FindConfig.excludeFields,
        disableAuth: FindConfig.disableAuth
    }).validate(config);

export const validateFindObject = command =>
    guardObject({
        // path: GuardSignal.TRIMMED_NON_EMPTY_STRING,
        find: (t, p) => (t === undefined && p.findOne) || (!p.findOne && FilterFootPrint(t)),
        findOne: (t, p) => (t === undefined && p.find) || (!p.find && FilterFootPrint(t)),
        sort: t => t === undefined || Validator.TRIMMED_NON_EMPTY_STRING(t),
        direction: (t, p) => t === undefined || (p.sort && DirectionList.includes(t)),
        limit: t => t === undefined || Validator.POSITIVE_INTEGER(t),
        random: (t, p) => t === undefined || (!p.sort && t === true),
    }).validate({ ...command });

export const validateCollectionName = collectionName => {
    // Check if the collection name is empty
    if (!collectionName || typeof collectionName !== 'string')
        throw `collection name must be a non-empty string but got ${collectionName}`;

    // Collection name cannot start with 'system.' (reserved)
    if (collectionName.startsWith('system.'))
        throw `collection name cannot start with 'system.' but got ${collectionName}`;

    // Collection name cannot contain the '$' character
    if (collectionName.includes('$'))
        throw `collection name cannot contain the '$' character but got ${collectionName}`;
}

function isValidDatabaseName(dbName) {
    // Check if the database name is empty
    if (!dbName || typeof dbName !== 'string') {
        return false;
    }

    // Database name must be less than 64 characters
    if (Buffer.byteLength(dbName, 'utf8') >= 64) {
        return false;
    }

    // Database name cannot contain invalid characters: / \ " . $ space
    const invalidDbChars = /[\/\\."$ ]/;
    if (invalidDbChars.test(dbName)) {
        return false;
    }

    return true;
}

function isValidCollectionName(collectionName) {
    try {
        validateCollectionName(collectionName);
        return true;
    } catch (_) {
        return false;
    }
};

export const validateFilter = (filter) => confirmFilterDoc({}, filter);

export const confirmFilterDoc = (data, filter) => {
    if (!Validator.OBJECT(filter)) throw `expected an object as filter value but got ${filter}`;

    const logicalList = ['$and', '$or', '$nor'];
    const logics = [[], [], []]; // [$and, $or, $nor]

    Object.entries(filter).forEach(([key, value]) => {
        if (logicalList.includes(key)) {
            if (!Array.isArray(value)) throw `"${key}" must be an array`;
            if (!value.length) throw `"${key}" must be a nonempty array`;
            logics[logicalList.indexOf(key)].push(...value.map(v => evaluateFilter(data, v)));
        } else logics[0].push(evaluateFilter(data, { [key]: value }));
    });
    const [AND, OR, NOR] = logics;

    return !AND.some(v => !v) &&
        (!OR.length || OR.some(v => v)) &&
        (!NOR.length || NOR.some(v => !v));
};

const plumeDoc = doc => [doc, ...Array.isArray(doc) ? doc : []];

export const defaultBSON = (value, instance) => {
    try {
        return instance.constructor(value);
    } catch (_) {
        return value;
    }
};

export const downcastBSON = d => {
    if (d instanceof BSONRegExp)
        return new RegExp(d.pattern, d.options);
    if (
        [
            Long,
            Double,
            Int32,
            Decimal128
        ].some(v => d instanceof v)
    ) return d * 1;
    return d;
};

const isBasicBSON = d =>
    [
        Code,
        ObjectId,
        Binary,
        MaxKey,
        MinKey,
        UUID,
        Timestamp,
        BSONSymbol
    ].some(v => d instanceof v);

export const CompareBson = {
    equal: (doc, q, explicit) => {
        doc = downcastBSON(doc);
        q = downcastBSON(q);

        if (
            isBasicBSON(q) ||
            isBasicBSON(doc)
        ) {
            return sameInstance(doc, q) &&
                JSON.stringify(doc) === JSON.stringify(q);
        }

        if (q instanceof RegExp) {
            return sameInstance(doc, q) ?
                (doc.source === q.source && doc.flags === q.flags) :
                (explicit && typeof doc === 'string' && q.test(doc));
        }
        return JSON.stringify(doc) === JSON.stringify(q)
    },
    greater: (doc, q) => {
        doc = downcastBSON(doc);
        q = downcastBSON(q);

        if (doc instanceof Timestamp || q instanceof Timestamp) {
            return sameInstance(doc, q) && doc.greaterThan(q);
        }

        return typeof doc === typeof q && ![q, doc].some(v => Array.isArray(v) || Validator.OBJECT(v)) && doc > q;
    },
    lesser: (doc, q) => {
        doc = downcastBSON(doc);
        q = downcastBSON(q);

        if (doc instanceof Timestamp || q instanceof Timestamp) {
            return sameInstance(doc, q) && doc.lessThan(q);
        }

        return typeof doc === typeof q && ![q, doc].some(v => Array.isArray(v) || Validator.OBJECT(v)) && doc < q;
    },
};

const BsonTypeMap = {
    double: [1, d => d instanceof Double],
    string: [2, d => typeof d === 'string'],
    object: [3, d => Validator.OBJECT(d)],
    array: [4, d => Array.isArray(d)],
    binData: [5, d => d instanceof Binary],
    objectId: [7, d => d instanceof ObjectId],
    bool: [8, d => typeof d === 'boolean'],
    date: [9, d => d instanceof Date],
    null: [10, d => d === null],
    regex: [11, d => d instanceof RegExp || d instanceof BSONRegExp],
    dbPointer: [12, d => d instanceof DBRef],
    javascript: [13, d => d instanceof Code],
    symbol: [14, d => d instanceof BSONSymbol],
    int: [16, d => d instanceof Int32],
    timestamp: [17, d => d instanceof Timestamp],
    long: [18, d => d instanceof Long],
    decimal: [19, d => d instanceof Decimal128],
    minKey: [-1, d => d instanceof MinKey],
    maxKey: [127, d => d instanceof MaxKey],
    number: [undefined, d => d instanceof Double ||
        d instanceof Int32 ||
        d instanceof Long ||
        d instanceof Decimal128 ||
        Validator.NUMBER(d)]
};

const COORDINATE_GUARD = [
    GuardSignal.COORDINATE.LONGITUDE_INT,
    GuardSignal.COORDINATE.LATITUDE_INT
];

const validateGeoNear = q =>
    guardObject({
        $geometry: {
            type: 'Point',
            coordinates: COORDINATE_GUARD
        },
        $minDistance: (t, p) => Validator.POSITIVE_NUMBER(t) && p.$maxDistance > t,
        $maxDistance: (t, p) => Validator.POSITIVE_NUMBER(t) && p.$minDistance < t
    }).validate(q);

const FilterUtils = {
    $eq: (doc, q) => plumeDoc(doc).some(v =>
        CompareBson.equal(v, q)
    ),

    $ne: (doc, q) => !FilterUtils.$eq(doc, q),

    $gt: (doc, q) => plumeDoc(doc).some(v =>
        CompareBson.greater(v, q)
    ),

    $gte: (doc, q) => plumeDoc(doc).some(v =>
        CompareBson.greater(v, q) || CompareBson.equal(v, q)
    ),

    $lt: (doc, q) => plumeDoc(doc).some(v =>
        CompareBson.lesser(v, q)
    ),

    $lte: (doc, q) => plumeDoc(doc).some(v =>
        CompareBson.lesser(v, q) || CompareBson.equal(v, q)
    ),

    $in: (doc, q) => {
        if (!Array.isArray(q)) throw '$in needs an array';
        return plumeDoc(doc).some(v =>
            q.some(k => CompareBson.equal(v, k, true))
        );
    },

    $nin: (doc, q) => !FilterUtils.$in(doc, q),

    $all: (doc, q) => {
        if (!Array.isArray(q)) throw '$all needs an array';
        return plumeDoc(doc).filter(v =>
            q.some(k => CompareBson.equal(v, k, true))
        ).length >= q.length;
    },

    $size: (doc, q) => {
        if (!Validator.POSITIVE_INTEGER(q))
            throw `Failed to parse $size. Expected a positive integer in: $size: ${q}`;
        return Array.isArray(doc) && doc.length === q;
    },

    $type: (doc, q) => {
        if (q === undefined) return false;
        return plumeDoc(doc).some(docx => {
            if (q in BsonTypeMap) {
                return BsonTypeMap[q][1](docx);
            }
            const c = Object.entries(BsonTypeMap).find(([_, v]) => v[0] === q);
            if (c) return c[1][1](docx);
            if (typeof q === 'number') throw `Invalid numerical type code: ${q}`;
            throw `Unknown type name alias: ${q}`;
        });
    },

    $regex: (doc, q) => {
        doc = downcastBSON(doc);
        q = downcastBSON(q);

        return plumeDoc(doc).some(docx => {
            if (q instanceof RegExp) {
                return typeof docx === 'string' ? q.test(docx) :
                    (docx instanceof RegExp &&
                        docx.source === q.source &&
                        docx.flags === q.flags);
            }

            if (typeof q === 'string') {
                return typeof docx === 'string' &&
                    !!docx.match(q);
            }

            throw '$regex has to be a string or a regex';
        });
    },

    $exists: (doc, q) => {
        return q ? doc !== undefined : doc === undefined;
    },

    $ne: (doc, q) => !FilterUtils.$eq(doc, q),

    $text: (parent, q) => {
        guardObject({
            $search: GuardSignal.STRING,
            $field: t => Validator.STRING(t) || (t.length && niceGuard(guardArray(GuardSignal.STRING), t)),
            $caseSensitive: t => t === undefined || Validator.BOOLEAN(t)
        }).validate(q);
        let { $field, $search, $caseSensitive } = q;

        $field = (Array.isArray($field) ? $field : [$field]).map(v => {
            const f = getLodash({ ...parent }, v);
            return typeof f === 'string' ? f : '';
        }).join(' ');

        if (!$caseSensitive) {
            $field = $field.toLowerCase();
            $search = $search.toLowerCase();
        }

        return $field.includes($search);
    },

    $geoIntersects: (doc, q) => {
        if (
            !niceGuard({
                $geometry: {
                    type: 'Point',
                    coordinates: COORDINATE_GUARD
                }
            }, q) &&
            !niceGuard({
                $geometry: {
                    type: 'LineString',
                    coordinates: [COORDINATE_GUARD, COORDINATE_GUARD]
                }
            }, q) &&
            !niceGuard({
                $geometry: {
                    type: 'Polygon',
                    coordinates: guardArray(guardArray(COORDINATE_GUARD))
                }
            }, q) &&
            !niceGuard({
                $geometry: {
                    type: 'MultiPoint',
                    coordinates: guardArray(COORDINATE_GUARD)
                }
            }, q) &&
            !niceGuard({
                $geometry: {
                    type: 'MultiLineString',
                    coordinates: guardArray([COORDINATE_GUARD, COORDINATE_GUARD])
                }
            }, q) &&
            !niceGuard({
                $geometry: {
                    type: 'MultiPolygon',
                    coordinates: guardArray(guardArray(guardArray(COORDINATE_GUARD)))
                }
            }, q)
        ) throw `unknown operator: ${q}`;

        try {
            return booleanIntersects(doc, q.$geometry);
        } catch (_) {
            return false;
        }
    },
    $geoWithin: (doc, q) => {
        const { $box, $geometry, $center, $centerSphere, $polygon } = { ...q };
        try {
            if ($geometry) {
                if (
                    niceGuard({
                        $geometry: {
                            type: 'Polygon',
                            coordinates: guardArray(guardArray(COORDINATE_GUARD))
                        }
                    }, q) ||
                    niceGuard({
                        $geometry: {
                            type: 'MultiPolygon',
                            coordinates: guardArray(guardArray(guardArray(COORDINATE_GUARD)))
                        }
                    }, q)
                ) {
                    return booleanWithin(doc, $geometry);
                }
            } else if ($box) {
                guardObject({ $box: Array(2).fill(COORDINATE_GUARD) }).validate(q);

                const [bottomLeft, topRight] = $box;
                const boundingBox = bboxPolygon([bottomLeft[0], bottomLeft[1], topRight[0], topRight[1]]);
                return booleanWithin(doc, boundingBox);
            } else if ($center) {
                guardObject({ $center: [COORDINATE_GUARD, GuardSignal.POSITIVE_NUMBER] }).validate(q);

                const [center, radius] = $center;
                return booleanWithin(doc, circle(center, radius, { units: 'kilometers' }));
            } else if ($centerSphere) {
                guardObject({ $centerSphere: [COORDINATE_GUARD, GuardSignal.POSITIVE_NUMBER] }).validate(q);

                const [center, radius] = $centerSphere;
                // Convert radians to km
                return booleanWithin(doc, circle(center, radius * 6371, { units: 'kilometers' }));
            } else if ($polygon) {
                guardObject({ $polygon: guardArray(COORDINATE_GUARD) }).validate(q);
                return booleanWithin(doc, polygon([$polygon]));
            }
        } catch (e) {
            if (!(e instanceof GuardError)) return false;
        }
        throw `unknown operator: ${JSON.stringify(q)}`;
    },
    $near: (doc, q) => {
        validateGeoNear(q);
        try {
            const { $geometry, $maxDistance, $minDistance } = q;
            const distanceOffset = distance($geometry, doc);

            if ($minDistance && distanceOffset < $minDistance) {
                return false;
            }

            if ($maxDistance && distanceOffset > $maxDistance) {
                return false;
            }

            return true;
        } catch (error) {
            return false;
        }
    },
    $nearSphere: (doc, q) => {
        validateGeoNear(q);
        try {
            const { $geometry, $maxDistance, $minDistance } = q.$nearSphere;
            const distanceOffset = distance($geometry, doc, { units: 'degrees' });

            if ($minDistance && distanceOffset < $minDistance) {
                return false;
            }

            if ($maxDistance && distanceOffset > $maxDistance) {
                return false;
            }

            return true;
        } catch (_) {
            return false;
        }
    }
};

const evaluateFilter = (data, filter = {}, parentData, level = 0) => {
    if (!Validator.OBJECT(filter)) throw `filter must be a raw object but got ${filter}`;
    if (!level) parentData = data;

    const logics = [];

    Object.entries(filter).map(([key, value]) => {
        if (key.startsWith('$') && (key !== '$text' || !Validator.OBJECT(value)) && !level)
            throw `unknown top level operator: ${key}`;

        let thisData;
        try {
            thisData = data && getLodash(data, key);
        } catch (_) { }

        if (key === '$text' && !level) {
            logics.push(FilterUtils.$text(parentData, value));
        } else if (Validator.OBJECT(value) && !level) {
            const valueEntrie = Object.entries(value);

            if (valueEntrie.some(([k]) => k.startsWith('$'))) {
                valueEntrie.forEach(([query, queryValue]) => {
                    if (query in FilterUtils) {
                        if (query === '$text' && level) throw '$text must be a top level operator';
                        logics.push(FilterUtils[query](thisData, queryValue));
                    } else if (query === '$not') {
                        if (Validator.OBJECT(queryValue)) {
                            logics.push(!evaluateFilter(thisData, queryValue, parentData, level + 1));
                        } else logics.push(
                            !plumeDoc(thisData).some(v => CompareBson.equal(v, queryValue, true))
                        );
                    } else throw `unknown operator: ${query}`;
                });
            } else if (valueEntrie.length) {
                logics.push(evaluateFilter(thisData, value, parentData, level + 1));
            } else {
                logics.push(
                    Validator.OBJECT(thisData) &&
                    !Object.keys(thisData).length
                );
            }
        } else {
            logics.push(
                plumeDoc(thisData).some(v => CompareBson.equal(v, value, true))
            );
        }
    });

    return !logics.some(v => !v);
};