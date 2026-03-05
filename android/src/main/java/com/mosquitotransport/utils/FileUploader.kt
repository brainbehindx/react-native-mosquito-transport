package com.mosquitotransport.utils

import android.net.Uri
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableMapKeySetIterator
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.util.Objects

class FileUploader {

    @Volatile
    private var isCancelled = false

    fun cancelUpload() {
        isCancelled = true
    }

    fun uploadFile(config: ReadableMap, callback: UploadCallback) {
        Thread {
            try {
                val fileUri = Uri.parse(config.getString("file"))
                val file = File(Objects.requireNonNull(fileUri.path))

                if (!file.exists()) {
                    throw FileNotFoundException("File not found: ${file.absolutePath}")
                }

                val totalBytes = file.length()
                val connection = (URL(config.getString("url")).openConnection() as HttpURLConnection).apply {
                    doOutput = true
                    requestMethod = "POST"
                }

                config.getMap("extraHeaders")?.let { headers ->
                    val iterator = headers.keySetIterator()
                    while (iterator.hasNextKey()) {
                        val key = iterator.nextKey()
                        connection.setRequestProperty(key, headers.getString(key))
                    }
                }

                connection.setRequestProperty("Content-Type", "buffer/upload")
                connection.setRequestProperty("hash-upload", config.getString("createHash"))
                connection.setRequestProperty("Mosquito-Destination", config.getString("destination"))

                if (config.hasKey("authToken")) {
                    connection.setRequestProperty("mtoken", config.getString("authToken"))
                }

                connection.setFixedLengthStreamingMode(totalBytes.toInt())

                val buffer = ByteArray(8192)
                var sentBytes = 0L

                FileInputStream(file).use { input ->
                    connection.outputStream.use { output ->
                        var bytesRead: Int

                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            if (isCancelled) {
                                connection.disconnect()
                                callback.onError(IOException("Upload cancelled"))
                                return@Thread
                            }

                            output.write(buffer, 0, bytesRead)
                            sentBytes += bytesRead
                            callback.onProgress(sentBytes, totalBytes)
                        }

                        output.flush()
                    }
                }

                val responseCode = connection.responseCode
                val responseStream =
                    if (responseCode in 200..399) connection.inputStream
                    else connection.errorStream

                val responseBody = readStream(responseStream)

                callback.onComplete(responseCode, responseBody)
                connection.disconnect()

            } catch (e: Exception) {
                callback.onError(e)
            }
        }.start()
    }

    @Throws(IOException::class)
    private fun readStream(stream: InputStream?): String {
        if (stream == null) return ""

        return BufferedReader(InputStreamReader(stream)).use { reader ->
            buildString {
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    append(line).append("\n")
                }
            }.trim()
        }
    }
}