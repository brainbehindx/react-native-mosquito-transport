import { CacheStore } from "../../helpers/variables";
import { grab, poke } from "poke-object";
import { calculateObjectSize } from '../../vendor/bson';

export const incrementDatabaseSize = (builder, path, size) => incrementDatabaseSizeCore(CacheStore.DatabaseStats, builder, path, size);

export const incrementDatabaseSizeCore = (baseObj, builder, path, size = 0) => {
    const { projectUrl, dbUrl, dbName } = builder;
    baseObj._db_size += size;

    const node = [projectUrl, dbUrl, dbName, path];

    const b4 = grab(baseObj.database, node, 0);
    poke(baseObj.database, node, b4 + size);
}

export const docSize = doc => doc ? calculateObjectSize({ _: doc }) : 0;