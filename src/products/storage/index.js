import EngineApi from "../../helpers/EngineApi";
import { prefixStoragePath } from "../../helpers/peripherals";
import { Scoped } from "../../helpers/variables";
import { encode as btoa } from 'base-64';
import { DeviceEventEmitter, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { buildFetchInterface, simplifyError } from "../../helpers/utils";

const LINKING_ERROR =
    `The package 'react-native-mosquitodb' doesn't seem to be linked. Make sure: \n\n` +
    Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
    '- You rebuilt the app after installing the package\n' +
    '- You are not using Expo Go\n';

const MosquitodbModule = NativeModules.Mosquitodb || (
    new Proxy({}, {
        get() {
            throw new Error(LINKING_ERROR);
        },
    })
),
    emitter = Platform.OS === 'android' ?
        DeviceEventEmitter : new NativeEventEmitter(MosquitodbModule);

export class MosquitoDbStorage {
    constructor(config) {
        this.builder = { ...config };
    }

    downloadFile(link = '', onComplete, destination, onProgress) {
        const { projectUrl, accessKey } = this.builder;

        if (destination && (!destination?.trim() || typeof destination !== 'string')) {
            onComplete?.({ error: 'destination_invalid', message: `destination is invalid in downloadFile()` });
            return;
        }
        if (destination) destination = prefixStoragePath(destination?.trim());

        if (typeof link !== 'string' || !link.trim().startsWith(`${EngineApi.staticStorage(projectUrl)}/`)) {
            onComplete?.({
                error: 'invalid_link',
                message: `link has an invalid value, expected a string that starts with "${EngineApi.staticStorage(projectUrl)}/"`
            });
            return;
        }
        link = link.trim();

        let hasFinished, isPaused;

        const processID = `${++Scoped.StorageProcessID}`,
            progressListener = emitter.addListener('mosquitodb-download-progress', ({ processID: ref, receivedBtyes, expectedBytes }) => {
                if (processID !== ref || hasFinished) return;
                onProgress?.({
                    receivedBtyes,
                    expectedBytes,
                    isPaused: !!isPaused,
                    pause: () => {
                        if (hasFinished || isPaused) return;
                        MosquitodbModule.pauseDownload(processID);
                        isPaused = true;
                    },
                    resume: () => {
                        if (hasFinished || !isPaused) return;
                        MosquitodbModule.pauseDownload(processID);
                        isPaused = false;
                    }
                });
            }),
            resultListener = emitter.addListener('mosquitodb-download-status', ({ processID: ref, error, errorDes, result }) => {
                if (processID !== ref || hasFinished) return;
                if (result)
                    try {
                        result = JSON.parse(result);
                    } catch (e) { }

                const path = result?.file || undefined;

                if (!hasFinished) onComplete?.(path ? undefined : (result?.simpleError || { error, errorDes }), path);
                resultListener.remove();
                progressListener.remove();
                hasFinished = true;
            });

        MosquitodbModule.downloadFile({
            url: link,
            authToken: Scoped.AuthJWTToken[projectUrl],
            ...(destination ? {
                destination: destination.substring('file://'.length),
                destinationDir: `${destination.substring('file://'.length)}`.split('/').filter((_, i, a) => i !== a.length - 1).join('/')
            } : {}),
            processID,
            urlName: link.split('/').pop(),
            authorization: `Bearer ${btoa(accessKey)}`
        });

        return () => {
            if (typeof hasFinished === 'boolean') return;
            MosquitodbModule.cancelDownload(processID);
            hasFinished = false;
        }
    }

    uploadFile(file = '', destination = '', onComplete, onProgress) {
        if (!file?.trim() || typeof file !== 'string') {
            onComplete?.({ error: 'file_path_invalid', message: `file is required in uploadFile()` });
            return;
        }
        destination = destination?.trim();

        const destErr = validateDestination(destination),
            isAsset = (file.startsWith('ph://') || file.startsWith('content://'));

        file = isAsset ? file.trim() : prefixStoragePath(file.trim());

        if (destErr) {
            onComplete?.({ error: 'destination_invalid', message: destErr });
            return;
        }

        let hasFinished;

        const { projectUrl, accessKey } = this.builder,
            processID = `${++Scoped.StorageProcessID}`,
            progressListener = emitter.addListener('mosquitodb-uploading-progress', ({ processID: ref, sentBtyes, totalBytes }) => {
                if (processID !== ref || hasFinished) return;
                onProgress?.({ sentBtyes, totalBytes });
            }),
            resultListener = emitter.addListener('mosquitodb-uploading-status', ({ processID: ref, error, errorDes, result }) => {
                if (processID !== ref || hasFinished) return;
                if (result)
                    try {
                        result = JSON.parse(result);
                    } catch (e) { }

                const downloadUrl = result?.downloadUrl || undefined;

                if (!hasFinished) onComplete?.(downloadUrl ? undefined : (result?.simpleError || { error, errorDes }), downloadUrl);
                resultListener.remove();
                progressListener.remove();
                hasFinished = true;
            });

        MosquitodbModule.uploadFile({
            url: EngineApi._uploadFile(projectUrl),
            file: isAsset ? file : file.substring('file://'.length),
            authToken: Scoped.AuthJWTToken[projectUrl],
            destination,
            processID,
            authorization: `Bearer ${btoa(accessKey)}`
        });

        return () => {
            if (typeof hasFinished === 'boolean') return;
            MosquitodbModule.cancelUpload(processID);
            hasFinished = false;
        }
    }

    deleteFile = (path) => deleteContent(this.builder, path);
    deleteFolder = (path) => deleteContent(this.builder, path, true);
}

const deleteContent = async (builder, path, isFolder) => {
    const { projectUrl, accessKey } = builder;

    try {
        const r = await (await fetch(
            EngineApi[isFolder ? '_deleteFolder' : '_deleteFile'](projectUrl),
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
    t = t.trim();

    if (!t || typeof t !== 'string') return `destination is required`;
    if (t.startsWith('/') || t.endsWith('/')) return 'destination must neither start with "/" nor end with "/"';
    let l = '', r;

    t.split('').forEach(e => {
        if (e === '/' && l === '/') r = 'invalid destination path, "/" cannot be side by side';
        l = e;
    });

    return r;
};