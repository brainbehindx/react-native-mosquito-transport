import GlobalListener from "./GlobalListener";

export const AuthListener = {};
export const AuthTokenListener = {};
export const TokenRefreshListener = {};
export const StoreReadyListener = new GlobalListener();
export const DatabaseRecordsListener = new GlobalListener();