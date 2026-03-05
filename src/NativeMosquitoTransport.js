// @flow
import type { TurboModule } from 'react-native';
import { type UnsafeObject } from 'react-native/Libraries/Types/CodegenTypes';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  // storage
  uploadFile(option: UnsafeObject): void;
  cancelUpload(process_id: string): void;
  downloadFile(option: UnsafeObject): void;
  cancelDownload(process_id: string): void;
  pauseDownload(process_id: string): void;
  resumeDownload(process_id: string): void;

  // utils
  getSystemUptime(): Promise<number>;

  // event listeners
  // readonly onMessage?: EventEmitter<{ message: string }>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('MosquitoTransport');
