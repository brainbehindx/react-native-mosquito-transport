interface MosquitoDbConfig {
    dbName?: string;
    dbUrl?: string;
    heapMemory?: number;
    projectUrl: string;
    disableCache?: boolean;
    accessKey: string;
    maxRetries?: number;
    awaitStorage?: boolean;
}

interface GetDatabase {
    collection: (path: string) => MosquitoDbCollection
}

interface mdeletion { $deletion: true }
interface mtimestamp { $timestamp: 'now' }

export const FIELD_DELETION: mdeletion;
export const TIMESTAMP: mtimestamp;
export function INCREMENT(count?: number): { $increment: number };

interface FetchHttpInit extends RequestInit {
    retries?: number;
    disableAuth?: boolean;
}

export default class RNMosquitoDb {
    constructor(config: MosquitoDbConfig);
    getDatabase(dbName?: string, dbUrl?: string): GetDatabase;
    collection(path: string): MosquitoDbCollection;
    auth(): MosquitoDbAuth;
    storage(): MosquitoDbStorage;
    fetchHttp(endpoint: string, init?: FetchHttpInit): Promise<Response>;
    listenReachableServer(callback: (reachable: boolean) => void): () => void;
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

    setOne: (value: DocumentWriteValue) => Promise<DocumentWriteResult>;

    setMany: (value: DocumentWriteValue) => Promise<DocumentWriteResult>;

    updateOne: (find: DocumentFind, value: DocumentWriteValue) => Promise<DocumentWriteResult>;

    updateMany: (find: DocumentFind, value: DocumentWriteValue) => Promise<DocumentWriteResult>;

    mergeOne: (find: DocumentFind, value: DocumentWriteValue) => Promise<DocumentWriteResult>;

    mergeMany: (find: DocumentFind, value: DocumentWriteValue) => Promise<DocumentWriteResult>;

    replaceOne: (find: DocumentFind, value: DocumentWriteValue) => Promise<DocumentWriteResult>;

    putOne: (find: DocumentFind, value: DocumentWriteValue) => Promise<DocumentWriteResult>;

    deleteOne: (find?: DocumentFind) => Promise<DocumentWriteResult>;

    deleteMany: (find?: DocumentFind) => Promise<DocumentWriteResult>;
}

interface DocumentResult {
    _id: any
}

interface DocumentError extends ErrorResponse {

}

interface GetConfig {
    excludeFields?: string | string[];
    returnOnly?: string | string[];
    extraction?: GetConfigExtraction | GetConfigExtraction[];
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