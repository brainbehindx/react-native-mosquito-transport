import { cloneDeep } from "lodash";
import { deserialize, serialize } from "../../vendor/bson";
import { Buffer } from "buffer";

export const deserializeBSON = (data, cast) => {
    if (typeof data === 'string')
        data = Buffer.from(data, 'base64');

    return deserialize(data, {
        bsonRegExp: !cast,
        promoteLongs: !!cast,
        promoteValues: !!cast,
        promoteBuffers: !!cast
    });
};

export const serializeToBase64 = doc => Buffer.from(serialize(doc)).toString('base64');

export const DatastoreParser = {
    encode: (obj) => {
        obj = cloneDeep(obj);
        const { command, config } = obj;

        const serializeQuery = (e) =>
            ['find', 'findOne'].forEach(n => {
                if (e?.[n]) e[n] = serializeToBase64({ _: e[n] });
            });

        if (command) serializeQuery(command);
        if (config) {
            if (config.extraction)
                (Array.isArray(config.extraction) ? config.extraction : [config.extraction]).forEach(e => {
                    serializeQuery(e);
                });
        }
        if (obj.data) obj.data = serializeToBase64({ _: obj.data });
        return obj;
    },
    decode: (obj, cast = true) => {
        obj = cloneDeep(obj);
        const { command, config } = obj;

        const serializeQuery = (e) =>
            ['find', 'findOne'].forEach(n => {
                if (e?.[n]) e[n] = deserializeBSON(e[n], cast)._;
            });

        if (command) serializeQuery(command);
        if (config) {
            if (config.extraction)
                (Array.isArray(config.extraction) ? config.extraction : [config.extraction]).forEach(e => {
                    serializeQuery(e);
                });
        }
        if (obj.data) obj.data = deserializeBSON(obj.data, cast)._;
        return obj;
    }
};