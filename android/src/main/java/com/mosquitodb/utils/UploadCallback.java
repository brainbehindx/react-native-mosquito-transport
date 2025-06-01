package com.mosquitodb.utils;

public interface UploadCallback {
    void onProgress(long sentBytes, long totalBytes);
    void onComplete(int responseCode, String responseBody);
    void onError(Exception e);
}
