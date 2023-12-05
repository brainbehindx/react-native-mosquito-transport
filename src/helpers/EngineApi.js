import { encode as btoa } from 'base-64';

const apis = {
    _readDocument: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._readDocument(baseApi)) : '_readDocument'}`,
    _writeDocument: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._writeDocument(baseApi)) : '_writeDocument'}`,
    _deleteCollection: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._deleteCollection(baseApi)) : '_deleteCollection'}`,
    _queryCollection: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._queryCollection(baseApi)) : '_queryCollection'}`,
    _writeMapDocument: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._writeMapDocument(baseApi)) : '_writeMapDocument'}`,
    _customSignin: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._customSignin(baseApi)) : '_customSignin'}`,
    _customSignup: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._customSignup(baseApi)) : '_customSignup'}`,
    _googleSignin: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._googleSignin(baseApi)) : '_googleSignin'}`,
    _appleSignin: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._appleSignin(baseApi)) : '_appleSignin'}`,
    _facebookSignin: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._facebookSignin(baseApi)) : '_facebookSignin'}`,
    _twitterSignin: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._twitterSignin(baseApi)) : '_twitterSignin'}`,
    _githubSignin: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._githubSignin(baseApi)) : '_githubSignin'}`,
    _signOut: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._signOut(baseApi)) : '_signOut'}`,
    _invalidateToken: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._invalidateToken(baseApi)) : '_invalidateToken'}`,
    _refreshAuthToken: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._refreshAuthToken(baseApi)) : '_refreshAuthToken'}`,
    _downloadFile: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._downloadFile(baseApi)) : '_downloadFile'}`,
    _uploadFile: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._uploadFile(baseApi)) : '_uploadFile'}`,
    _deleteFile: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._deleteFile(baseApi)) : '_deleteFile'}`,
    _deleteFolder: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._deleteFolder(baseApi)) : '_deleteFolder'}`,
    staticStorage: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis.staticStorage(baseApi)) : 'storage'}`,
    _documentCount: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._documentCount(baseApi)) : '_documentCount'}`,
    _areYouOk: (baseApi, ugly) => `${baseApi}/${ugly ? btoa(apis._areYouOk(baseApi)) : '_areYouOk'}`,
    // static path
    _listenCollection: '_listenCollection',
    _listenDocument: '_listenDocument',
    _startDisconnectWriteTask: '_startDisconnectWriteTask',
    _cancelDisconnectWriteTask: '_cancelDisconnectWriteTask',
    _listenUserVerification: '_listenUserVerification'
};

export default { ...apis };