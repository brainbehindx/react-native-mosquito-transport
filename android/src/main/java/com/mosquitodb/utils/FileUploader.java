package com.mosquitodb.utils;

import java.io.*;
import java.net.*;
import java.util.Objects;

import android.net.Uri;

import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableMapKeySetIterator;

public class FileUploader {

    private volatile boolean isCancelled = false;

    public void cancelUpload() {
        isCancelled = true;
    }

    public void uploadFile(ReadableMap config, UploadCallback callback) {
        new Thread(() -> {
            try {
                Uri fileUri = Uri.parse(config.getString("file"));
                File file = new File(Objects.requireNonNull(fileUri.getPath()));

                if (!file.exists()) {
                    throw new FileNotFoundException("File not found: " + file.getAbsolutePath());
                }

                long totalBytes = file.length();
                HttpURLConnection connection = (HttpURLConnection) new URL(config.getString("url")).openConnection();
                connection.setDoOutput(true);
                connection.setRequestMethod("POST");

                ReadableMap extraHeaders = config.getMap("extraHeaders");
                ReadableMapKeySetIterator iterator = Objects.requireNonNull(extraHeaders).keySetIterator();
                while (iterator.hasNextKey()) {
                    String key = iterator.nextKey();
                    connection.setRequestProperty(key, extraHeaders.getString(key));
                }

                connection.setRequestProperty("Content-Type", "buffer/upload");
                connection.setRequestProperty("hash-upload", config.getString("createHash"));
                connection.setRequestProperty("Mosquito-Destination", config.getString("destination"));
                if (config.hasKey("authToken")) {
                    connection.setRequestProperty("Mosquito-Token", config.getString("authToken"));
                }
                connection.setFixedLengthStreamingMode((int) totalBytes);

                OutputStream out = connection.getOutputStream();
                FileInputStream in = new FileInputStream(file);

                byte[] buffer = new byte[8192];
                long sentBytes = 0;
                int bytesRead;

                while ((bytesRead = in.read(buffer)) != -1) {
                    if (isCancelled) {
                        in.close();
                        out.close();
                        connection.disconnect();
                        callback.onError(new IOException("Upload cancelled"));
                        return;
                    }

                    out.write(buffer, 0, bytesRead);
                    sentBytes += bytesRead;
                    callback.onProgress(sentBytes, totalBytes);
                }

                out.flush();
                in.close();
                out.close();

                int responseCode = connection.getResponseCode();
                InputStream responseStream = (responseCode >= 200 && responseCode < 400)
                        ? connection.getInputStream()
                        : connection.getErrorStream();
                String responseBody = readStream(responseStream);

                callback.onComplete(responseCode, responseBody);
                connection.disconnect();
            } catch (Exception e) {
                callback.onError(e);
            }
        }).start();
    }

    private String readStream(InputStream stream) throws IOException {
        if (stream == null) return "";

        BufferedReader reader = new BufferedReader(new InputStreamReader(stream));
        StringBuilder result = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            result.append(line).append("\n");
        }
        reader.close();
        return result.toString().trim();
    }
}