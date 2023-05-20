interface MosquitoDbConfig {
    dbName?: string;
    dbUrl?: string;
    heapMemory?: number;
    projectUrl: string;
    disableCache?: boolean;
    accessKey: string;
    maxRetries?: number;
}

interface GetDatabase {

}

export default class MosquitoDb {
    constructor(config: MosquitoDbConfig) { }

    getDatabase(dbName?: string, dbUrl?: string): GetDatabase;
    collection(path: string): MosquitoDbCollection;
    auth(): MosquitoDbAuth;
    storage(): MosquitoDbStorage;
}

interface MosquitoDbCollection {

}

interface MosquitoDbAuth {

}

interface MosquitoDbStorage {

}