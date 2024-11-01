import { deserialize, serialize } from "bson";
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