import { Buffer } from "buffer";
import { updateCacheStore } from "../../helpers/utils";
import { CacheStore, Scoped } from "../../helpers/variables";
import cloneDeep from "lodash/cloneDeep";
import { deserialize, serialize } from "entity-serializer";
import { SQLITE_COMMANDS, SQLITE_PATH, useSqliteLinearAccessId } from "../../helpers/sqlite_manager";
import { incrementFetcherSize } from "./counter";

const { FETCH_RESOURCES } = SQLITE_PATH;

export const insertFetchResources = async (projectUrl, access_id, value) => {
    value = cloneDeep(value);
    const data = serialize(value).toString('base64');

    const { io } = Scoped.ReleaseCacheData;
    if (io) {
        if (!CacheStore.FetchedStore[projectUrl])
            CacheStore.FetchedStore[projectUrl] = {};
        const b4 = CacheStore.FetchedStore[projectUrl][access_id];
        incrementFetcherSize(projectUrl, data.length - (b4?.size || 0));
        CacheStore.FetchedStore[projectUrl][access_id] = {
            touched: Date.now(),
            data: value,
            size: data.length
        };
    } else {
        const initNode = projectUrl;

        await useSqliteLinearAccessId(FETCH_RESOURCES(projectUrl), access_id, 'httpFetch')(async sqlite => {
            if (!Scoped.initedSqliteInstances.httpFetch[initNode]) {
                Scoped.initedSqliteInstances.httpFetch[initNode] = (async () => {
                    await sqlite.executeSql(`CREATE TABLE IF NOT EXISTS main ( access_id TEXT PRIMARY KEY, value TEXT, touched INTEGER, size INTEGER )`).catch(() => null);
                    await Promise.allSettled([
                        sqlite.executeSql(SQLITE_COMMANDS.CREATE_INDEX('main', ['access_id'])),
                        sqlite.executeSql(SQLITE_COMMANDS.CREATE_INDEX('main', ['touched']))
                    ]);
                })();
            }

            await Scoped.initedSqliteInstances.httpFetch[initNode];
            const b4Data = await sqlite.executeSql(`SELECT access_id, size FROM main WHERE access_id = ?`, [access_id]).then(r =>
                r[0].rows.item(0)
            );
            await sqlite.executeSql(
                SQLITE_COMMANDS.MERGE('main', ['access_id', 'value', 'touched', 'size']),
                [access_id, data, Date.now(), data.length]
            );
            incrementFetcherSize(projectUrl, data.length - (b4Data?.size || 0));
        });
    }

    updateCacheStore(undefined, ['FetchedStore']);
}

export const getFetchResources = async (projectUrl, access_id) => {
    const { io } = Scoped.ReleaseCacheData;

    if (io) {
        const record = CacheStore.FetchedStore[projectUrl]?.[access_id];
        if (record) record.touched = Date.now();
        return record && cloneDeep(record?.data);
    }

    const res = await useSqliteLinearAccessId(FETCH_RESOURCES(projectUrl), access_id, 'httpFetch')(sqlite =>
        sqlite.executeSql('SELECT * FROM main WHERE access_id = ?', [access_id]).then(async r => {
            const data = deserialize(Buffer.from(r[0].rows.item(0).value, 'base64'));
            await sqlite.executeSql(SQLITE_COMMANDS.UPDATE_COLUMNS('main', ['touched'], 'access_id = ?'), [Date.now(), access_id]);
            return data;
        }).catch(() => null)
    );
    return res;
}