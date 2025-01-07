# react-native-mosquito-transport

React native javascript sdk for [mosquito-transport](https://github.com/brainbehindx/mosquito-transport).

## Installation

```sh
npm install react-native-mosquito-transport --save
```

or using yarn

```sh
yarn add react-native-mosquito-transport
```

## Usage

```js
import RNMosquitoTransport from "react-native-mosquito-transport";

RNMosquitoTransport.initializeCache({
  cachePassword: "****",
  cacheProtocol: "sqlite",
});

const mclient = new RNMosquitoTransport({
  projectUrl: "http://localhost:3444",
  accessKey: "SERVER_ACCESS_KEY",
});
```

## Additional Documentations

- [RNMosquitoTransport Constructor](#RNMosquitoTransportConstructor)
  - [dbName](#dbName)
  - [dbUrl](#dbUrl)
  - [projectUrl](#projectUrl)
  - [disableCache](#disableCache)
  - [accessKey](#accessKey)
  - [maxRetries](#maxRetries)
  - [enableE2E_Encryption](#enableE2E_Encryption)
  - [serverE2E_PublicKey](#serverE2E_PublicKey)
  - [extraHeaders](#extraHeaders)
  - [castBSON](#castBSON)
- [RNMosquitoTransport Methods](#RNMosquitoTransportMethods)
 - [initialCache](#initialCache)
 - [getDatabase](#getDatabase)
 - [collection](#collection)
 - [auth](#auth)
 - [storage](#storage)
 - [fetchHttp](#fetchHttp)
 - [listenReachableServer](#listenReachableServer)
 - [getSocket](#getSocket)
 - [batchWrite](#batchWrite)
- [TIMESTAMP](#TIMESTAMP)
- [AUTH_PROVIDER_ID](#AUTH_PROVIDER_ID)
- [DOCUMENT_EXTRACTION](#DOCUMENT_EXTRACTION)
- [GEO_JSON](#GEO_JSON)
- [FIND_GEO_JSON](#FIND_GEO_JSON)
- [DoNotEncrypt](#DoNotEncrypt)

## RNMosquitoTransport Constructor

### dbName


### dbUrl


### projectUrl

this is the base url of 

### disableCache
