import { Validator } from "guard-object";
import { incrementDatabaseSizeCore } from "../products/database/counter";
import { incrementFetcherSizeCore } from "../products/http_callable/counter";
import { FS_PATH, getSystem } from "./fs_manager";
import { unpoke } from "poke-object";

const { LIMITER_DATA, LIMITER_RESULT, DB_COUNT_QUERY, FETCH_RESOURCES } = FS_PATH;

const inlineFsData = (arr, access_id_node = 'access_id') =>
    arr.map(([access_id, obj]) => {
        obj[access_id_node] = access_id;
        return obj;
    });

export const purgeRedundantRecords = async (data, builder) => {
    const { io, maxLocalDatabaseSize = 10485760, maxLocalFetchHttpSize = 10485760 } = builder;

    /**
     * @type {import('./variables')['CacheStore']['DatabaseStats']}
     */
    const { _db_size, _fetcher_size, counters, database, fetchers } = data.DatabaseStats || {};

    if (io) {
        const purgeDatabase = () => {
            if (!Validator.POSITIVE_NUMBER(_db_size) || !maxLocalDatabaseSize || _db_size < maxLocalDatabaseSize) return;
            const DbListing = [];

            breakDbMap(data.DatabaseStore, (projectUrl, dbUrl, dbName, path, value) => {
                Object.entries(value.instance).forEach(([access_id, obj]) => {
                    DbListing.push({
                        builder: { projectUrl, dbUrl, dbName },
                        path,
                        access_id,
                        value: obj
                    });
                });
                Object.entries(value.episode).forEach(([access_id, limitObj]) => {
                    Object.entries(limitObj).forEach(([limit, obj]) => {
                        DbListing.push({
                            builder: { projectUrl, dbUrl, dbName },
                            path,
                            access_id,
                            limit,
                            value: obj,
                            isEpisode: true
                        });
                    });
                });
            });

            breakDbMap(data.DatabaseCountResult, (projectUrl, dbUrl, dbName, path, value) => {
                Object.entries(value).forEach(([access_id, obj]) => {
                    DbListing.push({
                        builder: { projectUrl, dbUrl, dbName },
                        path,
                        access_id,
                        value: obj,
                        isCount: true
                    });
                });
            });

            const redundantDbRanking = DbListing.sort((a, b) =>
                a.value.touched - b.value.touched
            );

            const newSize = maxLocalDatabaseSize / 2;
            let sizer = _db_size;
            let cuts = 0;

            for (let i = 0; i < redundantDbRanking.length; i++) {
                sizer -= redundantDbRanking[i].value.size || 0;
                ++cuts;
                if (sizer < newSize) break;
            }

            console.warn(`purging ${cuts} of ${redundantDbRanking.length} db entities`);
            redundantDbRanking.slice(0, cuts).forEach(({
                builder,
                path,
                access_id,
                isCount,
                isEpisode,
                limit,
                value: { size }
            }) => {
                const { projectUrl, dbUrl, dbName } = builder;
                if (isCount) {
                    unpoke(data.DatabaseCountResult, [projectUrl, dbUrl, dbName, path, access_id]);
                } else {
                    incrementDatabaseSizeCore(data.DatabaseStats, builder, path, -size);
                    if (isEpisode) {
                        unpoke(data.DatabaseStore, [projectUrl, dbUrl, dbName, path, 'episode', access_id, `${limit}`]);
                    } else {
                        unpoke(data.DatabaseStore, [projectUrl, dbUrl, dbName, path, 'instance', access_id]);
                    }
                }
            });
        }
        const purgeFetcher = () => {
            if (!Validator.POSITIVE_NUMBER(_fetcher_size) || !maxLocalFetchHttpSize || _fetcher_size < maxLocalFetchHttpSize) return;
            const redundantFetchRanking = Object.entries(data.FetchedStore).map(([projectUrl, access_id_Obj]) =>
                Object.entries(access_id_Obj).map(([access_id, data]) => ({
                    access_id,
                    projectUrl,
                    data
                }))
            ).flat().sort(([a], [b]) =>
                a.data.touched - b.data.touched
            );

            const newSize = maxLocalFetchHttpSize / 2;
            let sizer = _fetcher_size;
            let cuts = 0;

            for (let i = 0; i < redundantFetchRanking.length; i++) {
                sizer -= redundantFetchRanking[i].data.size || 0;
                ++cuts;
                if (sizer < newSize) break;
            }

            console.warn(`purging ${cuts} of ${redundantFetchRanking.length} fetcher entities`);
            redundantFetchRanking.slice(0, cuts).forEach(({ access_id, data: { size }, projectUrl }) => {
                incrementFetcherSizeCore(data.DatabaseStats, projectUrl, -size);
                unpoke(data.FetchedStore, [projectUrl, access_id]);
            });
            console.log('fetcher purging complete');
        }
        purgeDatabase();
        purgeFetcher();
    } else {
        // purge redundant data
        await Promise.allSettled([
            (async () => {
                try {
                    if (!Validator.POSITIVE_NUMBER(_db_size) || !maxLocalDatabaseSize || _db_size < maxLocalDatabaseSize) return;
                    const instances = [];

                    [database, counters].forEach((map, i) => {
                        breakDbMap(map, (projectUrl, dbUrl, dbName, path) => {
                            instances.push({
                                builder: { projectUrl, dbUrl, dbName },
                                isCounter: !!i,
                                path
                            });
                        });
                    });

                    const redundantDbRanking = await Promise.all(
                        instances.map(async obj => {
                            const { builder, isCounter, path } = obj;

                            try {
                                if (isCounter) {
                                    const data = inlineFsData(
                                        await getSystem(builder).list(DB_COUNT_QUERY(path), ['size', 'touched'])
                                    );
                                    return data.map(v => [v, obj]);
                                }

                                const [instanceData, resultData] = await Promise.all([
                                    getSystem(builder).list(LIMITER_DATA(path), ['touched', 'size']).catch(() => []),
                                    getSystem(builder).list(LIMITER_RESULT(path), ['touched', 'size']).catch(() => [])
                                ]).then(r =>
                                    r.map((v, i) => inlineFsData(v, i ? 'access_id_limiter' : 'access_id'))
                                );
                                return [...instanceData, ...resultData].map(v => [v, obj]);
                            } catch (error) {
                                console.error('redundantDbRanking err:', error);
                                return [];
                            }
                        })
                    ).then(r =>
                        r.flat().sort(([a], [b]) =>
                            a.touched - b.touched
                        )
                    );
                    const newSize = maxLocalDatabaseSize / 2;
                    let sizer = _db_size;
                    let cuts = 0;

                    for (let i = 0; i < redundantDbRanking.length; i++) {
                        sizer -= (redundantDbRanking[i][0].size || 0);
                        ++cuts;
                        if (sizer < newSize) break;
                    }

                    console.warn(`purging ${cuts} of ${redundantDbRanking.length} db entities`);
                    await Promise.all(redundantDbRanking.slice(0, cuts).map(async ([v, { builder, isCounter, path }]) => {
                        try {
                            const table = (isCounter ? DB_COUNT_QUERY : 'access_id_limiter' in v ? LIMITER_RESULT : LIMITER_DATA)(path);
                            const id_field = 'access_id_limiter' in v ? 'access_id_limiter' : 'access_id';
                            const primary_key = v[id_field];
                            await getSystem(builder).delete(table, primary_key);
                            if (!isCounter) incrementDatabaseSizeCore(data.DatabaseStats, builder, path, -v.size);
                        } catch (error) {
                            console.log('db redundantClearing err:', error);
                        }
                    }));
                    console.log('database purging complete');
                } catch (error) {
                    console.error('database purging err:', error);
                }
            })(),
            (async () => {
                try {
                    if (!Validator.POSITIVE_NUMBER(_fetcher_size) || !maxLocalFetchHttpSize || _fetcher_size < maxLocalFetchHttpSize) return;

                    const redundantFetchRanking = await Promise.all(
                        Object.entries(fetchers).map(async ([projectUrl]) => {
                            const data = inlineFsData(await getSystem(FETCH_RESOURCES(projectUrl)).list('main', ['touched', 'size']));
                            return data.map(v => [v, projectUrl]);
                        })
                    ).then(r =>
                        r.flat().sort(([a], [b]) =>
                            a.touched - b.touched
                        )
                    );

                    const newSize = maxLocalFetchHttpSize / 2;
                    let sizer = _fetcher_size;
                    let cuts = 0;

                    for (let i = 0; i < redundantFetchRanking.length; i++) {
                        sizer -= (redundantFetchRanking[i][0].size || 0);
                        ++cuts;
                        if (sizer < newSize) break;
                    }

                    console.warn(`purging ${cuts} of ${redundantFetchRanking.length} fetcher entities`);
                    await Promise.all(redundantFetchRanking.slice(0, cuts).map(async ([v, projectUrl]) => {
                        try {
                            await getSystem(FETCH_RESOURCES(projectUrl)).delete('main', v.access_id);
                            incrementFetcherSizeCore(data.DatabaseStats, projectUrl, -v.size);
                        } catch (error) {
                            console.log('fetcher redundantClearing err:', error, ' obj:', v, ' projectUrl:', projectUrl);
                        }
                    }));
                    console.log('fetcher purging complete');
                } catch (error) {
                    console.error('fetcher purging err:', error);
                }
            })()
        ]);
    }
}

export const breakDbMap = (obj = {}, callback) =>
    Object.entries(obj).forEach(([projectUrl, dbUrlObj]) => {
        Object.entries(dbUrlObj).forEach(([dbUrl, dbNameObj]) => {
            Object.entries(dbNameObj).forEach(([dbName, pathObj]) => {
                Object.entries(pathObj).forEach(([path, value]) => {
                    callback(projectUrl, dbUrl, dbName, path, value);
                });
            });
        });
    });