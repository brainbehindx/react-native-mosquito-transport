import { encodeBinary } from './peripherals';

const EngineApiBase = (baseApi, ugly, path) => {
    const url = new URL(baseApi);
    if (ugly) {
        url.pathname = `/e2e/${encodeBinary(path)}`;
    } else url.pathname = path;
    return url.href;
};

const apis = {
    _readDocument: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_readDocument'),
    _queryCollection: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_queryCollection'),
    _documentCount: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_documentCount'),
    _writeDocument: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_writeDocument'),
    _writeMapDocument: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_writeMapDocument'),
    _customSignin: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_customSignin'),
    _customSignup: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_customSignup'),
    _googleSignin: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_googleSignin'),
    _appleSignin: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_appleSignin'),
    _facebookSignin: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_facebookSignin'),
    _twitterSignin: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_twitterSignin'),
    _githubSignin: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_githubSignin'),
    _signOut: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_signOut'),
    _refreshAuthToken: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_refreshAuthToken'),
    _uploadFile: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_uploadFile'),
    _deleteFile: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_deleteFile'),
    _deleteFolder: (baseApi, ugly) => EngineApiBase(baseApi, ugly, '_deleteFolder'),
    staticStorage: (baseApi) => `${baseApi}/storage`,
    _areYouOk: (baseApi) => `${baseApi}/_areYouOk`,
    // static path
    _listenCollection: (ugly) => ugly ? encodeBinary(apis._listenCollection()) : '_listenCollection',
    _listenDocument: (ugly) => ugly ? encodeBinary(apis._listenDocument()) : '_listenDocument',
    _startDisconnectWriteTask: (ugly) => ugly ? encodeBinary(apis._startDisconnectWriteTask()) : '_startDisconnectWriteTask',
    _cancelDisconnectWriteTask: (ugly) => ugly ? encodeBinary(apis._cancelDisconnectWriteTask()) : '_cancelDisconnectWriteTask',
    _listenUserVerification: (ugly) => ugly ? encodeBinary(apis._listenUserVerification()) : '_listenUserVerification'
};

export default { ...apis };