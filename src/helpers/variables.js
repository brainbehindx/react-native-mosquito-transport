export const Scoped = {
    PendingIte: 0,
    IS_CONNECTED: undefined,
    AuthJWTToken: {},
    cacheStorageReducer: undefined,
    IsStoreReady: false,
    TokenRefreshTimer: {},
    LastTokenRefreshRef: {},
    StorageProcessID: 0
}

export const CacheStore = {
    DatabaseStore: {},
    DatabaseRecords: {},
    AuthStore: {},
    PendingWrites: {}
}

export const CacheConstant = { ...CacheStore };