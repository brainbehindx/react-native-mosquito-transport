
export const Scoped = {
    serverTimeOffset: undefined,
    PendingIte: 0,
    AnyProcessIte: 0,
    IS_CONNECTED: {},
    IS_TOKEN_READY: {},
    InitializedProject: {},
    ReleaseCacheData: undefined,
    AuthJWTToken: {},
    cacheStorageReducer: undefined,
    IsStoreReady: false,
    TokenRefreshTimer: {},
    LastTokenRefreshRef: {},
    StorageProcessID: 0,
    InitiatedForcedToken: {},
    PendingFetchCollective: {},
    PendingDbReadCollective: {},
    ActiveDatabaseListeners: {},
    OutgoingWrites: {},
    /**
     * @type {Promise<any> | undefined}
     */
    dispatchingWritesPromise: undefined,
    linearSqliteProcess: {
        database: {},
        dbQueryCount: {},
        httpFetch: {}
    },
    initedSqliteInstances: {
        httpFetch: undefined,
        dbQueryCount: {},
        database: {}
    }
};

export const SqliteCollective = {
    openedDb: {},
    openedDbProcess: {},
    closeDbPromises: {},
    openedDbReducerTimer: {}
};

export const CacheStore = {
    DatabaseStore: {},
    DatabaseCountResult: {},
    DatabaseStats: {
        /**
         * @type {{[projectUrl: string]: {[dbUrl: string]: {[dbName: string]: {[path: string]: number}}}}}
         */
        database: {},
        /**
         * @type {{[projectUrl: string]: {[dbUrl: string]: {[dbName: string]: {[path: string]: boolean}}}}}
         */
        counters: {},
        /**
         * @type {{[projectUrl: string]: number}}
         */
        fetchers: {},
        _db_size: 0,
        _fetcher_size: 0
    },
    AuthStore: {},
    PendingAuthPurge: {},
    EmulatedAuth: {},
    PendingWrites: {},
    FetchedStore: {}
};