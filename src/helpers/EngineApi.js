
const apis = {
    _readDocument: (baseApi) => `${baseApi}/_readDocument`,
    _writeDocument: (baseApi) => `${baseApi}/_writeDocument`,
    _deleteCollection: (baseApi) => `${baseApi}/_deleteCollection`,
    _queryCollection: (baseApi) => `${baseApi}/_queryCollection`,
    _writeMapDocument: (baseApi) => `${baseApi}/_writeMapDocument`,
    _customSignin: (baseApi) => `${baseApi}/_customSignin`,
    _customSignup: (baseApi) => `${baseApi}/_customSignup`,
    _googleSignin: (baseApi) => `${baseApi}/_googleSignin`,
    _appleSignin: (baseApi) => `${baseApi}/_appleSignin`,
    _facebookSignin: (baseApi) => `${baseApi}/_facebookSignin`,
    _twitterSignin: (baseApi) => `${baseApi}/_twitterSignin`,
    _githubSignin: (baseApi) => `${baseApi}/_githubSignin`,
    _signOut: (baseApi) => `${baseApi}/_signOut`,
    _invalidateToken: (baseApi) => `${baseApi}/_invalidateToken`,
    _refreshAuthToken: (baseApi) => `${baseApi}/_refreshAuthToken`,
    _downloadFile: (baseApi) => `${baseApi}/_downloadFile`,
    _uploadFile: (baseApi) => `${baseApi}/_uploadFile`,
    _deleteFile: (baseApi) => `${baseApi}/_deleteFile`,
    _deleteFolder: (baseApi) => `${baseApi}/_deleteFolder`,
    staticStorage: (baseApi) => `${baseApi}/storage`,
    _documentCount: (baseApi) => `${baseApi}/_documentCount`,
    _areYouOk: (baseApi) => `${baseApi}/_areYouOk`
}

export default { ...apis };