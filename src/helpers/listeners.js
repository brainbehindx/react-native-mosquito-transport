import SubscriptionListener from "subscription-listener";

export const AuthListener = new SubscriptionListener();
export const AuthTokenListener = new SubscriptionListener();
export const TokenRefreshListener = new SubscriptionListener();
export const StoreReadyListener = new SubscriptionListener();
export const ServerReachableListener = new SubscriptionListener();
export const DatabaseRecordsListener = new SubscriptionListener();