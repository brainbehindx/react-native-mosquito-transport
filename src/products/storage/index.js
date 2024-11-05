import EngineApi from "../../helpers/engine_api";
import { encodeBinary, prefixStoragePath } from "../../helpers/peripherals";
import { Scoped } from "../../helpers/variables";
import { DeviceEventEmitter, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { awaitReachableServer, buildFetchInterface } from "../../helpers/utils";
import { awaitRefreshToken } from "../auth/accessor";
import { simplifyError } from "simplify-error";

const LINKING_ERROR =
    `The package 'react-native-mosquito-transport' doesn't seem to be linked. Make sure: \n\n` +
    Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
    '- You rebuilt the app after installing the package\n' +
    '- You are not using Expo Go\n';

const RNMTModule = NativeModules.Mosquitodb || (
    new Proxy({}, {
        get() {
            throw new Error(LINKING_ERROR);
        },
    })
);
const emitter = Platform.OS === 'android' ?
    DeviceEventEmitter : new NativeEventEmitter(RNMTModule);

export class MTStorage {
    constructor(config) {
        this.builder = { ...config };
    }

    downloadFile(link = '', onComplete, destination, onProgress) {
        let hasFinished, isPaused, hasCancelled;

        const { projectUrl, accessKey, awaitStorage } = this.builder;

        if (destination && (typeof destination !== 'string' || !destination.trim())) {
            onComplete?.({ error: 'destination_invalid', message: 'destination must be a non-empty string' });
            return () => { };
        }
        if (destination) destination = prefixStoragePath(destination?.trim());

        if (typeof link !== 'string' || !link.trim().startsWith(`${EngineApi.staticStorage(projectUrl)}/`)) {
            onComplete?.({
                error: 'invalid_link',
                message: `link has an invalid value, expected a string that starts with "${EngineApi.staticStorage(projectUrl)}/"`
            });
            return () => { };
        }
        link = link.trim();

        const processID = `${++Scoped.StorageProcessID}`;
        const init = async () => {
            if (awaitStorage) await awaitReachableServer(projectUrl);
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
                        RNMTModule.pauseDownload(processID);
                        isPaused = true;
                    },
                    resume: () => {
                        if (hasFinished || !isPaused || hasCancelled) return;
                        RNMTModule.resumeDownload(processID);
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
                hasFinished = true;
            });

            RNMTModule.downloadFile({
                url: link,
                authToken: Scoped.AuthJWTToken[projectUrl],
                ...destination ? {
                    destination: destination.substring('file://'.length),
                    destinationDir: `${destination.substring('file://'.length)}`.split('/').slice(0, -1).join('/')
                } : {},
                processID,
                urlName: link.split('/').pop(),
                authorization: `Bearer ${encodeBinary(accessKey)}`
            });
        }

        init();

        return () => {
            if (hasFinished || hasCancelled) return;
            RNMTModule.cancelDownload(processID);
            hasCancelled = true;
            setTimeout(() => {
                onComplete?.({ error: 'download_aborted', message: 'The download process was aborted' });
            }, 1);
        }
    }

    uploadFile(file = '', destination = '', onComplete, onProgress, createHash) {
        let hasFinished, hasCancelled;

        if (typeof file !== 'string' || !file.trim()) {
            onComplete?.({ error: 'file_path_invalid', message: 'file must be a non-empty string in uploadFile()' });
            return () => { };
        }
        destination = destination?.trim?.();

        try {
            validateDestination(destination);
        } catch (error) {
            onComplete?.({ error: 'destination_invalid', message: error });
            return () => { };
        }

        const isAsset = (file.startsWith('ph://') || file.startsWith('content://'));

        file = isAsset ? file.trim() : prefixStoragePath(file.trim());

        const { projectUrl, accessKey, awaitStorage, uglify } = this.builder;
        const processID = `${++Scoped.StorageProcessID}`;

        const init = async () => {
            if (awaitStorage) await awaitReachableServer(projectUrl);
            await awaitRefreshToken(projectUrl);

            if (hasCancelled) return;
            const progressListener = emitter.addListener('mt-uploading-progress', ({ processID: ref, sentBtyes, totalBytes }) => {
                if (processID !== ref || hasFinished || hasCancelled) return;
                onProgress?.({ sentBtyes, totalBytes });
            });
            const resultListener = emitter.addListener('mt-uploading-status', ({ processID: ref, error, errorDes, result }) => {
                if (processID !== ref || hasFinished) return;
                if (result)
                    try {
                        result = JSON.parse(result);
                    } catch (e) { }

                const downloadUrl = result?.downloadUrl || undefined;

                if (!hasFinished && !hasCancelled)
                    onComplete?.(downloadUrl ? undefined : (result?.simpleError || { error, message: errorDes }), downloadUrl);
                resultListener.remove();
                progressListener.remove();
                hasFinished = true;
            });

            RNMTModule.uploadFile({
                url: EngineApi._uploadFile(projectUrl, uglify),
                file: isAsset ? file : file.substring('file://'.length),
                authToken: Scoped.AuthJWTToken[projectUrl],
                createHash: createHash ? 'yes' : 'no',
                destination,
                processID,
                authorization: `Bearer ${encodeBinary(accessKey)}`
            });
        }

        init();

        return () => {
            if (hasFinished || hasCancelled) return;
            hasCancelled = true;
            setTimeout(() => {
                onComplete?.({ error: 'upload_aborted', message: 'The upload process was aborted' });
            }, 1);
            RNMTModule.cancelUpload(processID);
        }
    }

    deleteFile = (path) => deleteContent(this.builder, path);
    deleteFolder = (path) => deleteContent(this.builder, path, true);
}

const deleteContent = async (builder, path, isFolder) => {
    const { projectUrl, accessKey, uglify } = builder;

    try {
        const r = await (await fetch(
            EngineApi[isFolder ? '_deleteFolder' : '_deleteFile'](projectUrl, uglify),
            buildFetchInterface({ path }, accessKey, Scoped.AuthJWTToken[projectUrl], 'DELETE')
        )).json();
        if (r.simpleError) throw r;
        if (r.status !== 'success') throw 'operation not successful';
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