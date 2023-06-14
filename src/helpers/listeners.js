import GlobalListener from "./GlobalListener";

export const InitializedProject = {};
export const AuthListener = new GlobalListener();
export const AuthTokenListener = new GlobalListener();
export const TokenRefreshListener = new GlobalListener();
export const StoreReadyListener = new GlobalListener();
export const ServerReachableListener = new GlobalListener();
export const DatabaseRecordsListener = new GlobalListener();