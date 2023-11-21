import { encode as btoa } from 'base-64';
import { Platform } from 'react-native';

export const CACHE_STORAGE_PATH = btoa('mosquitoDbFreezer:__'),
    DEFAULT_CACHE_PASSWORD = btoa('mosquitoCachePassword:__'),
    LOCAL_STORAGE_PATH = () => {
        const fs = require('react-native-fs');
        return `${Platform.OS === 'android' ? fs.ExternalCachesDirectoryPath : fs.CachesDirectoryPath}/${btoa('mosquitoFreezer')}`;
    },
    DEFAULT_DB_NAME = 'DEFAULT_DB',
    DEFAULT_DB_URL = 'mongodb://127.0.0.1:27017',
    DEFAULT_ENCRYPT_IV = '****';

export const CACHE_PROTOCOL = {
    ASYNC_STORAGE: 'async-storage',
    REACT_NATIVE_FS: 'reat-native-fs'
};

export const RETRIEVAL = {
    STICKY: 'sticky',
    STICKY_NO_AWAIT: 'sticky-no-await',
    STICKY_RELOAD: 'sticky-reload',
    DEFAULT: 'default',
    CACHE_NO_AWAIT: 'cache-no-await',
    NO_CACHE_NO_AWAIT: 'no-cache-no-await'
};

export const DELIVERY = {
    DEFAULT: 'default',
    NO_CACHE: 'no-cache',
    NO_AWAIT: 'no-await',
    NO_AWAIT_NO_CACHE: 'no-await-no-cache',
    AWAIT_NO_CACHE: 'await-no-cache',
    CACHE_NO_AWAIT: 'cache-no-await'
};

export const WRITE_OPS = {
    $SET: '$set',
    $PUSH: '$push',
    $PULL: '$pull',
    $UNSET: '$unset',
    $INC: '$inc',
    $MAX: '$max',
    $MIN: '$min',
    $MUL: '$mul',
    $RENAME: '$rename'
    // $SET_ON_INSERT: '$setOnInsert'
},
    WRITE_OPS_LIST = Object.values(WRITE_OPS);

export const READ_OPS = {
    $IN: '$in',
    $ALL: '$all',
    $NIN: '$nin',
    $GT: '$gt',
    $GTE: '$gte',
    $LT: '$lt',
    $LTE: '$lte',
    $TEXT: '$text',
    // $EQ: '$eq',
    // $REGEX: '$regex',
    // $EXISTS: '$exists',
    $NEAR: '$near',
    $TYPE: '$type',
    $SIZE: '$size',
    // $NE: '$ne'
},
    READ_OPS_LIST = Object.values(READ_OPS);