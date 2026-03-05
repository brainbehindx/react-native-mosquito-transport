package com.mosquitotransport.utils

interface UploadCallback {
    fun onProgress(sentBytes: Long, totalBytes: Long)
    fun onComplete(responseCode: Int, responseBody: String)
    fun onError(e: Exception)
}