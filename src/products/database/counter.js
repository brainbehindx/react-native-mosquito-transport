import { CacheStore } from "../../helpers/variables";
import { serializeToBase64 } from "./bson";
import { grab, poke } from "poke-object";

export const incrementDatabaseSize = (builder, path, size) => incrementDatabaseSizeCore(CacheStore.DatabaseStats, builder, path, size);

export const incrementDatabaseSizeCore = (baseObj, builder, path, size = 0) => {
    const { projectUrl, dbUrl, dbName } = builder;
    baseObj._db_size += size;

    const node = [projectUrl, dbUrl, dbName, path];

    const b4 = grab(baseObj.database, node, 0);
    poke(baseObj.database, node, b4 + size);
}

export const docSize = doc => doc ? serializeToBase64({ _: doc }).length : 0;