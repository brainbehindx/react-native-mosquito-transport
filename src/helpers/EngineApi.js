import { encodeBinary } from './peripherals';

const apis = {
    _readDocument: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._readDocument(baseApi)) : '_readDocument'}`,
    _writeDocument: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._writeDocument(baseApi)) : '_writeDocument'}`,
    _deleteCollection: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._deleteCollection(baseApi)) : '_deleteCollection'}`,
    _queryCollection: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._queryCollection(baseApi)) : '_queryCollection'}`,
    _writeMapDocument: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._writeMapDocument(baseApi)) : '_writeMapDocument'}`,
    _customSignin: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._customSignin(baseApi)) : '_customSignin'}`,
    _customSignup: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._customSignup(baseApi)) : '_customSignup'}`,
    _googleSignin: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._googleSignin(baseApi)) : '_googleSignin'}`,
    _appleSignin: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._appleSignin(baseApi)) : '_appleSignin'}`,
    _facebookSignin: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._facebookSignin(baseApi)) : '_facebookSignin'}`,
    _twitterSignin: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._twitterSignin(baseApi)) : '_twitterSignin'}`,
    _githubSignin: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._githubSignin(baseApi)) : '_githubSignin'}`,
    _signOut: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._signOut(baseApi)) : '_signOut'}`,
    _invalidateToken: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._invalidateToken(baseApi)) : '_invalidateToken'}`,
    _refreshAuthToken: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._refreshAuthToken(baseApi)) : '_refreshAuthToken'}`,
    _downloadFile: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._downloadFile(baseApi)) : '_downloadFile'}`,
    _uploadFile: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._uploadFile(baseApi)) : '_uploadFile'}`,
    _deleteFile: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._deleteFile(baseApi)) : '_deleteFile'}`,
    _deleteFolder: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._deleteFolder(baseApi)) : '_deleteFolder'}`,
    staticStorage: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis.staticStorage(baseApi)) : 'storage'}`,
    _documentCount: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._documentCount(baseApi)) : '_documentCount'}`,
    _areYouOk: (baseApi, ugly) => `${baseApi}/${ugly ? encodeBinary(apis._areYouOk(baseApi)) : '_areYouOk'}`,
    // static path
    _listenCollection: (ugly) => `${ugly ? encodeBinary(apis._listenCollection()) : '_listenCollection'}`,
    _listenDocument: (ugly) => `${ugly ? encodeBinary(apis._listenDocument()) : '_listenDocument'}`,
    _startDisconnectWriteTask: (ugly) => `${ugly ? encodeBinary(apis._startDisconnectWriteTask()) : '_startDisconnectWriteTask'}`,
    _cancelDisconnectWriteTask: (ugly) => `${ugly ? encodeBinary(apis._cancelDisconnectWriteTask()) : '_cancelDisconnectWriteTask'}`,
    _listenUserVerification: (ugly) => `${ugly ? encodeBinary(apis._listenUserVerification()) : '_listenUserVerification'}`
};

export default { ...apis };