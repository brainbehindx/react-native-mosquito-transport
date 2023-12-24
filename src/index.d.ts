interface MosquitoDbConfig {
    dbName?: string;
    dbUrl?: string;
    heapMemory?: number;
    projectUrl: string;
    disableCache?: boolean;
    accessKey: string;
    maxRetries?: number;
    /**
     * setting this to true will encrypt all outgoing and incoming request. This is recommended for production applications to enable end-to-end encryption using [Tweetnacl](https://github.com/dchest/tweetnacl-js) and to prevent request interception by browser extensions, network intermediaries or other hijacking tools
     */
    enableE2E_Encryption?: boolean;
}

interface GetDatabase {
    collection: (path: string) => MosquitoDbCollection
}

interface mtimestamp { $timestamp: 'now' }

export const TIMESTAMP: mtimestamp;
export function DOCUMENT_EXTRACTION(path: string): { $dynamicValue: number };

interface ReleaseCacheOption {
    /**
     * This password will be used to securely store your data locally
     */
    cachePassword?: string;
    /**
     * select the mechanism for storing data locally
     * - async-storage: uses [@react-native-async-storage/async-storage](https://github.com/react-native-async-storage/async-storage) for storing data, make sure you have this package installed before setting this as the value
     * - reat-native-fs: uses [reat-native-fs](https://github.com/itinance/react-native-fs) for storing data, make sure you have this package installed before setting this as the value
     */
    cacheProtocol?: 'async-storage' | 'reat-native-fs';
}

interface MosquitoDbSocket {
    timeout: (timeout?: number) => ({
        emitWithAck: (...args: any) => Promise<any>;
    });
    emit: (...args: any) => void;
    emitWithAck: () => Promise<any>;
    on: (route: string, callback?: () => any) => void;
    once: (route: string, callback?: () => any) => void;
    destroy: () => void;
}

export default class RNMosquitoDb {
    constructor(config: MosquitoDbConfig);
    static releaseCache(option?: ReleaseCacheOption): void;
    getDatabase(dbName?: string, dbUrl?: string): GetDatabase;
    collection(path: string): MosquitoDbCollection;
    auth(): MosquitoDbAuth;
    storage(): MosquitoDbStorage;
    fetchHttp(endpoint: string, init?: RequestInit, config?: FetchHttpConfig): Promise<Response>;
    listenReachableServer(callback: (reachable: boolean) => void): () => void;
    getSocket(options: { disableAuth?: boolean }): MosquitoDbSocket;
}

interface MosquitoDbCollection {
    find: (find?: DocumentFind) => ({
        get: (config?: GetConfig) => Promise<DocumentResult[]>;
        listen: (callback: (snapshot?: DocumentResult[]) => void, onError?: (error?: DocumentError) => void, config?: GetConfig) => void;
        count: () => Promise<number>;
        limit: (limit: number) => ({
            random: (config?: GetConfig) => Promise<DocumentResult[]>;
            get: (config?: GetConfig) => Promise<DocumentResult[]>;
            listen: (callback: (snapshot?: DocumentResult[]) => void, onError?: (error?: DocumentError) => void, config?: GetConfig) => void;
            sort: (sort: Sort | string, direction?: SortDirection) => ({
                get: (config?: GetConfig) => Promise<DocumentResult[]>;
                listen: (callback: (snapshot?: DocumentResult[]) => void, onError?: (error?: DocumentError) => void, config?: GetConfig) => void;
            })
        });
        sort: (sort: Sort | string, direction?: SortDirection) => ({
            get: (config?: GetConfig) => Promise<DocumentResult[]>;
            listen: (callback: (snapshot?: DocumentResult[]) => void, onError?: (error?: DocumentError) => void, config?: GetConfig) => void;
            limit: (limit: number) => ({
                get: (config?: GetConfig) => Promise<DocumentResult[]>;
                listen: (callback: (snapshot?: DocumentResult[]) => void, onError?: (error?: DocumentError) => void, config?: GetConfig) => void;
            })
        })
    });
    sort: (sort: Sort | string, direction?: SortDirection) => ({
        get: (config?: GetConfig) => Promise<DocumentResult[]>;
        listen: (callback: (snapshot?: DocumentResult[]) => void, onError?: (error?: DocumentError) => void, config?: GetConfig) => void;
        limit: (limit: number) => ({
            get: (config?: GetConfig) => Promise<DocumentResult[]>;
            listen: (callback: (snapshot?: DocumentResult[]) => void, onError?: (error?: DocumentError) => void, config?: GetConfig) => void;
        })
    });
    limit: (limit: number) => ({
        random: (config?: GetConfig) => Promise<DocumentResult[]>;
        get: (config?: GetConfig) => Promise<DocumentResult[]>;
        listen: (callback: (snapshot?: DocumentResult[]) => void, onError?: (error?: DocumentError) => void, config?: GetConfig) => void;
        sort: (sort: Sort | string, direction?: SortDirection) => ({
            get: (config?: GetConfig) => Promise<DocumentResult[]>;
            listen: (callback: (snapshot?: DocumentResult[]) => void, onError?: (error?: DocumentError) => void, config?: GetConfig) => void;
        })
    });
    count: () => Promise<number>;
    get: (config?: GetConfig) => Promise<DocumentResult[]>;
    listen: (callback: (snapshot?: DocumentResult[]) => void, onError?: (error?: DocumentError) => void, config?: GetConfig) => void;
    findOne: (findOne?: DocumentFind) => ({
        get: (config?: GetConfig) => Promise<DocumentResult>;
        listen: (callback: (snapshot?: DocumentResult) => void, onError?: (error?: DocumentError) => void, config?: GetConfig) => void;
    });
    onDisconnect: () => ({
        setOne: (value: DocumentWriteValue) => () => void;
        setMany: (value: DocumentWriteValue) => () => void;
        updateOne: (find: DocumentFind, value: DocumentWriteValue) => () => void;
        updateMany: (find: DocumentFind, value: DocumentWriteValue) => () => void;
        mergeOne: (find: DocumentFind, value: DocumentWriteValue) => () => void;
        mergeMany: (find: DocumentFind, value: DocumentWriteValue) => () => void;
        replaceOne: (find: DocumentFind, value: DocumentWriteValue) => () => void;
        putOne: (find: DocumentFind, value: DocumentWriteValue) => () => void;
        deleteOne: (find: DocumentFind) => () => void;
        deleteMany: (find?: DocumentFind) => () => void;
    })

    setOne: (value: DocumentWriteValue, config?: WriteConfig) => Promise<DocumentWriteResult>;

    setMany: (value: DocumentWriteValue, config?: WriteConfig) => Promise<DocumentWriteResult>;

    updateOne: (find: DocumentFind, value: DocumentWriteValue, config?: WriteConfig) => Promise<DocumentWriteResult>;

    updateMany: (find: DocumentFind, value: DocumentWriteValue, config?: WriteConfig) => Promise<DocumentWriteResult>;

    mergeOne: (find: DocumentFind, value: DocumentWriteValue, config?: WriteConfig) => Promise<DocumentWriteResult>;

    mergeMany: (find: DocumentFind, value: DocumentWriteValue, config?: WriteConfig) => Promise<DocumentWriteResult>;

    replaceOne: (find: DocumentFind, value: DocumentWriteValue, config?: WriteConfig) => Promise<DocumentWriteResult>;

    putOne: (find: DocumentFind, value: DocumentWriteValue, config?: WriteConfig) => Promise<DocumentWriteResult>;

    deleteOne: (find?: DocumentFind, config?: WriteConfig) => Promise<DocumentWriteResult>;

    deleteMany: (find?: DocumentFind, config?: WriteConfig) => Promise<DocumentWriteResult>;
}

interface DocumentResult {
    _id: any
}

interface DocumentError extends ErrorResponse {

}

interface FetchHttpConfig {
    retrieval?: GetConfig['retrieval'];
    disableAuth?: boolean;
    enableMinimizer?: boolean;
}

type Delievery = 'default' | 'no-cache' | 'no-await' | 'no-await-no-cache' | 'await-no-cache' | 'cache-no-await';

interface WriteConfig {
    /**
     * send authentication token along with this request
     */
    disableAuth?: boolean;

    /**
     * This property defines how the write will be committed and sent
     * 
     * - default: 
     * - no-cache: 
     * - no-await: 
     * - no-await-no-cache: 
     * - await-no-cache: 
     * - cache-no-await: 
     */
    delivery?: Delievery;
}

type Retrieval = 'sticky' | 'sticky-no-await' | 'sticky-reload' | 'default' | 'cache-no-await' | 'no-cache-no-await';

interface GetConfig {
    excludeFields?: string | string[];
    returnOnly?: string | string[];
    extraction?: GetConfigExtraction | GetConfigExtraction[];
    /**
     * This property determines how requested data is being access and handled
     * 
     * - default: we try getting fresh data from server if server is reachable, else we check if local data exists and return it, if no local data exist we await for client->server connectivity, then try getting the data, return it and cache it for future need. ⚠️ This respect disableCache value
     * 
     * - sticky: if local data exists for the specified query, such data is returned and no-ops afterwards. If no local data is found, we await for client->server connectivity and try to get fresh data from serve, return the data and cache it for future need. ⚠️ This does not respect disableCache value
     * 
     * - sticky-no-await: if local data exists for the specified query, such data is returned and no-ops afterwards. If no local data is found, we try to get fresh data from serve, we throw an error if server is not reachable else if server returns requested data, we return such data and cache it for future need. ⚠️ This does not respect disableCache value
     * 
     * - sticky-reload: if local data exists for the specified query, such data is returned, then we try getting fresh data from the server and caching it for future need. If no local data is found, we await for client->server connectivity and try to get fresh data from serve, return the data and cache it for future need
     * 
     * - cache-no-await: we try getting fresh data from server if server is reachable, else we check if local data exists and return it, if no local data exist we throw an error
     * 
     * - no-cache-no-await: we try getting fresh data from server if server is reachable, else we throw an error
     * 
     * To learn and see more examples on this, Please visit https://brainbehindx.com/mosquitodb/docs/reading_data/retrieval
     */
    retrieval?: Retrieval;
    /**
     * - 0: returns data that may have been internally updated locally with updateOne, updateMany, mergeOne, deleteOne, deleteMany, putOne, replaceOne
     * - 1: returns exact data which was cached in the last query process
     * 
     * @defaults - 0
     * 
     * To learn and see more examples on this, Please visit https://brainbehindx.com/mosquitodb/docs/reading_data/retrieval
     */
    episode?: 0 | 1;
    /**
     * send authentication token along with this request
     * 
     * @default - false
     */
    disableAuth?: boolean;
    /**
     * this reduces duplicate query calls with the same operation resultant to a single request call.
     * 
     * - Example:
     * 
     * ```js
     * 
     * const mserver = new RNMosquitoDb({ projectUrl: 'http..', accessKey: '..'});
     * const minimizedUser = ['james', 'john', 'james', 'john'];
     * const unminimizedUser = ['anthony', 'albert', 'anthony', 'albert'];
     * 
     * // operation will be reduced to two request: james and john
     * 
     * minimizedUser.forEach(e=> {
     *   mserver.collection('user').findOne({ _id: e }).get();
     * });
     * 
     * // operation will not be reduced and therefore four request will be sent: anthony, albert, anthony, albert
     * 
     * unminimizedUser.forEach(e=> {
     *   mserver.collection('user').findOne({ _id: e }).get();
     * });
     * ```
     * defaults to false
     * 
     * To learn and see more examples on this, Please visit https://brainbehindx.com/mosquitodb/docs/reading_data/retrieval
     */
    disableMinimizer?: boolean;
}

interface GetConfigExtraction {
    limit?: number;
    sort: string;
    direction?: 'desc' | 'asc' | 1 | -1
    collection: string;
    find?: DocumentFind;
    findOne?: DocumentFind
}

interface DocumentFind {
    $and?: any[];
    $nor?: any[];
    $or?: any[];
    $text?: {
        $search: string;
        $language?: string;
        $caseSensitive?: boolean;
        $diacriticSensitive?: boolean;
    };
    // $where?: string | ((this: TSchema) => boolean);
    $comment?: string | Document;
}

declare interface Document {
    [key: string]: any;
}

interface DocumentWriteResult { }

interface DocumentWriteValue {

}

interface MosquitoDbAuth {
    customSignin: (email: string, password: string) => Promise<SigninResult>;
    customSignup: (email: string, password: string, name?: string, metadata?: Object) => Promise<SigninResult>;
    googleSignin: (token: string) => Promise<SignupResult>;
    appleSignin: () => Promise<SignupResult>;
    facebookSignin: () => Promise<SignupResult>;
    twitterSignin: () => Promise<SignupResult>;
    githubSignin: () => Promise<SignupResult>;
    listenVerifiedStatus: (callback?: (verified?: boolean) => void, onError?: (error?: ErrorResponse) => void) => () => void;
    listenAuthToken: (callback: (token: string) => void) => () => void;
    getAuthToken: () => Promise<string>;
    listenAuth: (callback: (auth: AuthData) => void) => () => void;
    getAuth: () => Promise<AuthData>;
    signOut: () => Promise<void>;
    forceRefreshToken: () => Promise<string>;
}

interface SigninResult {
    user: AuthData;
    token: string;
}

interface SignupResult extends SigninResult {
    isNewUser: boolean;
}

interface AuthData {
    email?: string;
    metadata: Object;
    signupMethod: 'google' | 'apple' | 'custom' | 'github' | 'twitter' | 'facebook' | string;
    currentAuthMethod: 'google' | 'apple' | 'custom' | 'github' | 'twitter' | 'facebook' | string;
    joinedOn: number;
    encryptionKey: string;
    uid: string;
    claims: Object;
    emailVerified: boolean;
    profile: {
        photo: string;
        name: string;
    }
}

interface MosquitoDbStorage {
    downloadFile: (link: string, onComplete?: (error?: ErrorResponse, filepath?: string) => void, destination?: string, onProgress?: (stats: DownloadProgressStats) => void) => () => void;
    uploadFile: (file: string, destination: string, onComplete?: (error?: ErrorResponse, downloadUrl?: string) => void, onProgress?: (stats: UploadProgressStats) => void) => () => void;
    deleteFile: (path: string) => Promise<void>;
    deleteFolder: (folder: string) => Promise<void>;
}

interface DownloadProgressStats {
    receivedBtyes: number;
    expectedBytes: number;
    isPaused: boolean;
    pause: () => void;
    resume: () => void;
}

interface UploadProgressStats {
    sentBtyes: number;
    totalBytes: number;
}

interface ErrorResponse {
    error: string;
    message: string;
}

/** @public */
export declare type Sort = string | Exclude<SortDirection, {
    $meta: string;
}> | string[] | {
    [key: string]: SortDirection;
} | Map<string, SortDirection> | [string, SortDirection][] | [string, SortDirection];

/** @public */
export declare type SortDirection = 1 | -1 | 'asc' | 'desc' | 'ascending' | 'descending' | {
    $meta: string;
};