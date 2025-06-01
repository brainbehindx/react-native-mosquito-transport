package com.mosquitodb;

import android.util.ArrayMap;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableNativeMap;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.mosquitodb.utils.FileUploader;
import com.mosquitodb.utils.UploadCallback;

@ReactModule(name = MosquitodbModule.NAME)
public class MosquitodbModule extends ReactContextBaseJavaModule {
  public static final String NAME = "Mosquitodb";
  private final ArrayMap<String, FileUploader> uploaderMap = new ArrayMap<>();

  public MosquitodbModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  @NonNull
  public String getName() {
    return NAME;
  }

  @ReactMethod
  public void uploadFile(ReadableMap readable) {
    String processId = readable.getString("processID");
    FileUploader uploader = new FileUploader();

    uploader.uploadFile(readable, new UploadCallback() {
      @Override
      public void onProgress(long sentBytes, long totalBytes) {
        WritableMap progress = new WritableNativeMap();
        progress.putInt("sentBytes", (int) sentBytes);
        progress.putInt("totalBytes", (int) totalBytes);
        progress.putString("processID", processId);
        sendEvent("mt-uploading-progress", progress);
      }

      @Override
      public void onComplete(int responseCode, String responseBody) {
        WritableMap statusData = new WritableNativeMap();
        statusData.putString("processID", processId);
        statusData.putString("result", responseBody);
        sendEvent("mt-uploading-status", statusData);
      }

      @Override
      public void onError(Exception e) {
        WritableMap statusData = new WritableNativeMap();
        statusData.putString("processID", processId);
        statusData.putString("error", "internal_error");
        statusData.putString("errorDes", e.getLocalizedMessage());
        sendEvent("mt-uploading-status", statusData);
      }
    });
    uploaderMap.put(processId, uploader);
  }

  @ReactMethod
  public void cancelUpload(String processID) {
    FileUploader uploader = uploaderMap.get(processID);
    if (uploader != null) {
      uploader.cancelUpload();
    }
  }

  private void sendEvent(String eventName, @Nullable WritableMap params) {
    getReactApplicationContext()
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(eventName, params);
  }
}
