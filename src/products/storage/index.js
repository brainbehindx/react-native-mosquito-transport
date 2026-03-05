import EngineApi from "../../helpers/engine_api";
import { deserializeE2E, prefixStoragePath } from "../../helpers/peripherals";
import { Scoped } from "../../helpers/variables";
import { NativeEventEmitter } from 'react-native';
import NativeMosquitoTransport from '../../NativeMosquitoTransport';
import { awaitReachableServer, buildFetchInterface, buildFetchResult } from "../../helpers/utils";
import { awaitRefreshToken } from "../auth/accessor";
import { simplifyError } from "simplify-error";
import { Validator } from "guard-object";

const emitter = new NativeEventEmitter(NativeMosquitoTransport);

export class MTStorage {
    constructor(config) {
        this.builder = { ...config };
    }

    downloadFile = (link = '', destination, options) => {
        const { awaitServer, onProgress } = options || {};
        let hasFinished, isPaused, hasCancelled;

        const { projectUrl, extraHeaders } = this.builder;
        let onComplete;

        const promise = new Promise((resolve, reject) => {
            onComplete = (err, path) => {
                if (hasFinished) return;
                hasFinished = true;
                if (path) {
                    resolve(path);
                } else reject(err);
            }
        });

        promise.abort = () => {
            if (hasFinished || hasCancelled) return;
            NativeMosquitoTransport.cancelDownload(processID);
            hasCancelled = true;
            onComplete?.({ error: 'download_aborted', message: 'The download process was aborted' });
        }

        if (destination && (typeof destination !== 'string' || !destination.trim())) {
            onComplete?.({ error: 'destination_invalid', message: 'destination must be a non-empty string' });
            return promise;
        }
        if (destination) destination = prefixStoragePath(destination?.trim());

        if (typeof link !== 'string' || !Validator.LINK(link = link.trim())) {
            onComplete?.({
                error: 'invalid_link',
                message: `downloadFile first argument has an invalid value, expected a valid link string but got '${link}' instead`
            });
            return promise;
        }

        const processID = `${++Scoped.StorageProcessID}`;
        const init = async () => {
            if (awaitServer) await awaitReachableServer(projectUrl);
            await awaitRefreshToken(projectUrl);

            if (hasCancelled) return;

            const progressListener = emitter.addListener('mt-download-progress', ({ processID: ref, receivedBtyes, expectedBytes }) => {
                if (processID !== ref || hasFinished || hasCancelled) return;
                onProgress?.({
                    receivedBtyes,
                    expectedBytes,
                    isPaused: !!isPaused,
                    pause: () => {
                        if (hasFinished || isPaused || hasCancelled) return;
                        NativeMosquitoTransport.pauseDownload(processID);
                        isPaused = true;
                    },
                    resume: () => {
                        if (hasFinished || !isPaused || hasCancelled) return;
                        NativeMosquitoTransport.resumeDownload(processID);
                        isPaused = false;
                    }
                });
            });
            const resultListener = emitter.addListener('mt-download-status', ({ processID: ref, error, errorDes, result }) => {
                if (processID !== ref) return;
                if (result)
                    try {
                        result = JSON.parse(result);
                    } catch (e) { }

                const path = result?.file || undefined;

                if (!hasFinished && !hasCancelled)
                    onComplete?.(path ? undefined : (result?.simpleError || { error, message: errorDes }), path);
                resultListener.remove();
                progressListener.remove();
            });

            NativeMosquitoTransport.downloadFile({
                url: link,
                authToken: Scoped.AuthJWTToken[projectUrl],
                ...destination ? {
                    destination: destination.substring('file://'.length),
                    destinationDir: `${destination.substring('file://'.length)}`.split('/').slice(0, -1).join('/')
                } : {},
                processID,
                urlName: link.split('/').pop(),
                extraHeaders: extraHeaders || {},
            });
        }

        init();
        return promise;
    }

    uploadFile = (file = '', destination = '', options) => {
        const { createHash, awaitServer, onProgress } = options || {};
        let hasFinished, hasCancelled;
        let thisComplete;

        const promise = new Promise((resolve, reject) => {
            thisComplete = (err, url) => {
                if (hasFinished) return;
                hasFinished = true;
                if (url) {
                    resolve(url);
                } else reject(err);
            }
        });

        promise.abort = () => {
            if (hasFinished || hasCancelled) return;
            hasCancelled = true;
            setTimeout(() => {
                thisComplete?.({ error: 'upload_aborted', message: 'The upload process was aborted' });
            }, 0);
            NativeMosquitoTransport.cancelUpload(processID);
        };

        if (typeof file !== 'string' || !file.trim()) {
            thisComplete?.({ error: 'file_path_invalid', message: 'file must be a non-empty string in uploadFile()' });
            return promise;
        }
        destination = destination?.trim?.();

        try {
            validateDestination(destination);
        } catch (error) {
            thisComplete?.({ error: 'destination_invalid', message: error });
            return promise;
        }

        const isAsset = file.startsWith('ph://') || file.startsWith('content://');
        file = isAsset ? file.trim() : prefixStoragePath(file.trim());

        const { projectUrl, uglify, extraHeaders } = this.builder;
        const processID = `${++Scoped.StorageProcessID}`;
        const thisProjectUrl = options?.projectUrl || projectUrl;

        const init = async () => {
            if (awaitServer) await awaitReachableServer(projectUrl);
            await awaitRefreshToken(projectUrl);

            if (hasCancelled) return;
            const progressListener = emitter.addListener('mt-uploading-progress', ({ processID: ref, sentBytes, totalBytes }) => {
                if (processID !== ref || hasFinished || hasCancelled) return;
                onProgress?.({ sentBytes, totalBytes });
            });
            const resultListener = emitter.addListener('mt-uploading-status', ({ processID: ref, error, errorDes, result }) => {
                if (processID !== ref) return;
                if (result)
                    try {
                        result = JSON.parse(result);
                    } catch (_) { }

                const downloadUrl = result?.downloadUrl || undefined;
                thisComplete?.(downloadUrl ? undefined : (result?.simpleError || { error, message: errorDes }), downloadUrl);
                resultListener.remove();
                progressListener.remove();
            });
            const authToken = Scoped.AuthJWTToken[projectUrl];

            NativeMosquitoTransport.uploadFile({
                url: EngineApi._uploadFile(thisProjectUrl, uglify),
                file: isAsset ? file : file.substring('file://'.length),
                ...authToken ? { authToken } : {},
                createHash: createHash ? 'yes' : 'no',
                destination,
                processID,
                extraHeaders: extraHeaders || {}
            });
        }

        init();
        return promise;
    }

    deleteFile = (path, options) => deleteContent(this.builder, path, options);
    deleteFolder = (path, options) => deleteContent(this.builder, path, options, true);
}

const { _deleteFile, _deleteFolder } = EngineApi;

const deleteContent = async (builder, path, options, isFolder) => {
    const { projectUrl, uglify, extraHeaders, serverE2E_PublicKey } = builder;

    try {
        const [reqBuilder, [privateKey]] = await buildFetchInterface({
            method: 'DELETE',
            authToken: Scoped.AuthJWTToken[projectUrl],
            body: { path },
            extraHeaders,
            serverE2E_PublicKey,
            uglify
        });
        const thisProjectUrl = options?.projectUrl || projectUrl;

        const res = await fetch((isFolder ? _deleteFolder : _deleteFile)(thisProjectUrl, uglify), reqBuilder);
        const data = await buildFetchResult(res, uglify);
        const result = uglify ? await deserializeE2E(data, serverE2E_PublicKey, privateKey) : data;

        if (result.status !== 'success') throw 'operation not successful';
    } catch (e) {
        if (e?.simpleError) throw e.simpleError;
        throw simplifyError('unexpected_error', `${e}`).simpleError;
    }
}

const validateDestination = (t = '') => {
    if (typeof t !== 'string' || !t.trim()) throw 'path must be a non-empty string';
    if (t.startsWith(' ') || t.endsWith(' ')) throw 'path must be trimmed';
    if (t.startsWith('./') || t.startsWith('../')) throw 'path must be absolute';
    if (t.endsWith('/')) throw 'path must not end with "/"';
    if ('?'.split('').some(v => t.includes(v)))
        throw `path must not contain ?`;

    t = t.trim();
    let l = '';

    t.split('').forEach(e => {
        if (e === '/' && l === '/') throw 'invalid destination path, "/" cannot be duplicated side by side';
        l = e;
    });
};