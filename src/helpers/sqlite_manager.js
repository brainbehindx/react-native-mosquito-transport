import { enablePromise, openDatabase } from 'react-native-sqlite-storage';
import { Scoped, SqliteCollective } from './variables';
import { niceHash } from './peripherals';

enablePromise(true);
let sqliteKeyHash;

/**
 * this method implement a centralize approach for opening and closing of sqlite database to ensure consistency across multiple task opening and closing the database in diferent order
 * 
 * @param {string} name 
 * @returns {Promise<import('react-native-sqlite-storage').SQLiteDatabase>}
 */
export const openDB = async (name, onName) => {

    if (name?.projectUrl) {
        const { projectUrl, dbUrl, dbName } = name;
        name = encodeURIComponent(`${projectUrl}_${dbUrl}_${dbName}`) + '.db';
    }

    const { sqliteKey } = Scoped.ReleaseCacheData;

    if (sqliteKey) {
        const thisHash = await (sqliteKeyHash || (sqliteKeyHash = niceHash(sqliteKey)));
        name = `${thisHash}__${name}`;
    }
    onName?.(name);

    if (!SqliteCollective.openedDb[name]) {
        SqliteCollective.openedDbProcess[name] = 0;
        SqliteCollective.openedDb[name] = Promise.allSettled([SqliteCollective.closeDbPromises[name] || Promise.resolve()]).then(() =>
            openDatabase({
                location: 'default',
                name,
                key: sqliteKey
            }).then(db => {
                const prevClose = db.close.bind(db);

                db.close = () => new Promise((resolve, reject) => {
                    if (--SqliteCollective.openedDbProcess[name] === 0) {
                        let willClose;
                        const timer = setTimeout(async () => {
                            willClose = true;
                            delete SqliteCollective.openedDb[name];
                            delete SqliteCollective.openedDbProcess[name];
                            SqliteCollective.closeDbPromises[name] = prevClose().then(() => {
                                resolve('active');
                            }).catch(e => {
                                reject(new Error(`${e}`));
                            }).finally(() => {
                                delete SqliteCollective.closeDbPromises[name];
                            });
                            delete SqliteCollective.openedDbReducerTimer[name];
                        }, 7);

                        SqliteCollective.openedDbReducerTimer[name] = () => {
                            clearTimeout(timer);
                            if (!willClose) resolve('passive');
                            delete SqliteCollective.openedDbReducerTimer[name];
                        }
                    } else resolve('passive');
                });
                return db;
            })
        );
    }

    SqliteCollective.openedDbReducerTimer[name]?.();
    ++SqliteCollective.openedDbProcess[name];
    const thisDb = await SqliteCollective.openedDb[name];
    let hasClosed;

    const thisClose = async () => {
        if (hasClosed) return;
        hasClosed = true;
        return (await thisDb.close());
    }

    return new Proxy({}, {
        get: (_, n) => {
            if (n === 'close') {
                return thisClose;
            } else if (typeof thisDb[n] === 'function')
                return thisDb[n].bind(thisDb);
            return thisDb[n];
        },
        set: (_, n, v) => {
            thisDb[n] = v;
        }
    });
};

/**
 * this method linearize read/write on sqlite ensuring consistency across concurrent operations
 * 
 * @param {any} builder 
 * @param {string} access_id 
 * @param {'database' | 'dbQueryCount' | 'httpFetch'} node
 * @returns {(task: (sqlite: import("react-native-sqlite-storage").SQLiteDatabase, db_filename: string) => Promise<{any}> )=> Promise<{any}>}
 */
export const useSqliteLinearAccessId = (builder, access_id, node) => async (task) => {
    const { projectUrl, dbUrl, dbName } = builder;
    const nodeId = typeof builder === 'string' ? `${builder}_${access_id}` : `${projectUrl}_${dbUrl}_${dbName}_${access_id}`;
    let db_filename;

    const sqlite = await openDB(builder, n => db_filename = n);

    const thatProcess = Scoped.linearSqliteProcess[node][nodeId];

    const thisPromise = new Promise(async (resolve, reject) => {
        try {
            if (thatProcess !== undefined) await thatProcess;
        } catch (_) { }
        try {
            resolve(await task(sqlite, db_filename));
        } catch (error) {
            console.error('useSqliteLinearAccessId err:', error, ' builder:', builder);
            reject(error);
        } finally {
            if (Scoped.linearSqliteProcess[node][nodeId] === thisPromise)
                delete Scoped.linearSqliteProcess[node][nodeId];
            sqlite.close();
        }
    });

    Scoped.linearSqliteProcess[node][nodeId] = thisPromise;
    return (await thisPromise);
};

export const SQLITE_PATH = {
    FILE_NAME: 'MOSQUITO_TRANSPORT.db',
    TABLE_NAME: 'MT_MAIN',
    LIMITER_RESULT: path => `"${encodeURIComponent(path)}_LIMITER_RESULT"`,
    LIMITER_DATA: path => `"${encodeURIComponent(path)}_LIMITER_DATA"`,
    DB_COUNT_QUERY: path => `"${encodeURIComponent(path)}_DB_COUNT_QUERY"`,
    FETCH_RESOURCES: projectUrl => `FETCH_RESOURCES_${encodeURIComponent(projectUrl)}.db`
};

export const SQLITE_COMMANDS = {
    MERGE: (table, columns = []) => `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${columns.fill('?').join(', ')})`,
    UPDATE_COLUMNS: (table, columns = [], query = '') => `UPDATE ${table} SET ${columns.map(v => `${v} = ?`).join(', ')} WHERE ${query}`,
    CREATE_INDEX: (table, columns) => `CREATE INDEX idx_${columns.join('_')} ON ${table}(${columns.join(', ')})`,
    DELETE_ROW: (table, query) => `DELETE FROM ${table} WHERE ${query}`
}