import React

@objc(Mosquitodb)
class Mosquitodb:  RCTEventEmitter, URLSessionDataDelegate {
    
    public override init() {
        super.init()
    }
    
    override public static func requiresMainQueueSetup() -> Bool {
        return true;
    }
    
    @objc(supportedEvents)
    override public func supportedEvents() -> [String] {
        return [
            "mt-uploading-progress",
            "mt-uploading-status",
            "mt-download-progress",
            "mt-download-status"
        ]
    }
    
    var uploadTask: [String: MosquitodbUploadTask] = [:]
    var downloadTask: [String: MosquitodbDownloadTask] = [:]
    
    @objc(downloadFile:)
    func downloadFile(options: [String: Any]) -> Void {
        let processID = options["processID"] as! String
        downloadTask[processID] = MosquitodbDownloadTask()
        downloadTask[processID]?.downloadFile(options: options, completion: { res in
            let status = res![0] as? String
            
            self.sendEvent(withName: status, body: res![1])
            if status == "mt-download-status" {
                self.downloadTask.removeValue(forKey: processID)
            }
        })
    }
    
    @objc(uploadFile:)
    func uploadFile(options: [String: Any]) -> Void {
        let processID = options["processID"] as! String
        
        uploadTask[processID] = MosquitodbUploadTask()
        uploadTask[processID]?.uploadFile(options: options, completion: { res in
            let status = res![0] as? String
            
            self.sendEvent(withName: status, body: res![1])
            if status == "mt-uploading-status" {
                self.uploadTask.removeValue(forKey: processID)
            }
        })
    }
    
    @objc(cancelUpload:)
    func cancelUpload (processID: String)-> Void {
        uploadTask[processID]?.cancelUpload()
    }
    
    @objc(cancelDownload:)
    func cancelDownload (processID: String)-> Void {
        downloadTask[processID]?.cancelDownload()
    }
    
    @objc(pauseDownload:)
    func pauseDownload (processID: String)-> Void {
        downloadTask[processID]?.pauseDownload()
    }
    
    @objc(resumeDownload:)
    func resumeDownload (processID: String)-> Void {
        downloadTask[processID]?.resumeDownload()
    }
}


class MosquitodbUploadTask: NSObject, URLSessionDataDelegate {
    
    var mainProcessID: String = ""
    var mainTask : URLSessionUploadTask? = nil
    var mainOptions: [String: Any] = [:]
    var trigger: (([Any]?)->())? = nil
    
    
    func uploadFile(options: [String: Any], completion: @escaping ([Any]?)->()) -> Void {
        let processID = options["processID"] as! String
        let filepath = options["file"] as! String
        let url = options["url"] as! String
        let destination = options["destination"] as! String
        let authorization = options["authorization"] as! String
        
        do {
            let rawData = try Data(contentsOf: URL(fileURLWithPath: filepath))
            
            var request = URLRequest(url: URL(string: url)!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue(authorization, forHTTPHeaderField: "Authorization")
            if options["authToken"] != nil {
                request.setValue(options["authToken"] as? String, forHTTPHeaderField: "Mosquito-Token")
            }
            request.setValue("buffer/upload", forHTTPHeaderField: "Content-Type")
            request.setValue(destination, forHTTPHeaderField: "Mosquito-Destination")
            
            let session = URLSession(configuration: URLSessionConfiguration.default, delegate: self, delegateQueue: nil)
            let task = session.uploadTask(with: request, from: rawData)
            
            mainProcessID = processID
            mainTask = task
            mainOptions = options
            trigger = completion
            
            task.resume()
        } catch {
            completion([
                "mt-uploading-status", [
                    "processID": processID,
                    "error": "file_not_found",
                    "errorDes": "\(error)"
                ]
            ])
            trigger = nil
        }
    }
    
    func cancelUpload(){
        mainTask?.cancel()
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        
        trigger!([
            "mt-uploading-progress", [
                "sentBtyes": Float(totalBytesSent),
                "totalBytes": Float(totalBytesExpectedToSend),
                "processID": mainProcessID
            ]
        ])
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if error != nil {
            trigger!([
                "mt-uploading-status", [
                    "processID": mainProcessID,
                    "error": "failed",
                    "errorDes": error?.localizedDescription
                ]
            ])
            trigger = nil
        }
    }
    
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        
        if let responseText = String(data: data, encoding: .utf8) {
            trigger!([
                "mt-uploading-status", [
                    "processID": mainProcessID,
                    "result": responseText
                ]])
        }else {
            trigger!([
                "mt-uploading-status", [
                    "processID": mainProcessID,
                    "error": "invalid_response",
                    "errorDes": "the server response was invalid"
                ]])
        }
        trigger = nil
    }
}


class MosquitodbDownloadTask: NSObject, URLSessionDownloadDelegate {
    
    var mainProcessID: String = ""
    var mainTask : URLSessionDownloadTask? = nil
    var mainOptions: [String: Any] = [:]
    var trigger: (([Any]?)->())? = nil
    
    func downloadFile(options: [String: Any], completion: @escaping ([Any]?)->()) -> Void {
        let processID = options["processID"] as! String
        let url = options["url"] as! String
        let authorization = options["authorization"] as! String
        
        var request = URLRequest(url: URL(string: url)!)
        request.httpMethod = "POST"
        request.setValue(authorization, forHTTPHeaderField: "Authorization")
        if options["authToken"] != nil {
            request.setValue(options["authToken"] as? String, forHTTPHeaderField: "Mosquito-Token")
        }
        
        let session = URLSession(configuration: URLSessionConfiguration.default, delegate: self, delegateQueue: nil)
        let task = session.downloadTask(with: request)
        
        mainProcessID = processID
        mainTask = task
        mainOptions = options
        trigger = completion
        task.resume()
        print("MosquitodbDownloadTask started:\(mainProcessID)")
    }
    
    func cancelDownload ()-> Void {
        mainTask?.cancel()
    }
    
    func pauseDownload ()-> Void {
        mainTask?.suspend()
    }
    
    func resumeDownload ()-> Void {
        mainTask?.resume()
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?){
        print("mosquito didCompleteWithError process:\(String(describing: error?.localizedDescription))")
        
        if error != nil {
            trigger!([
                "mt-download-status", [
                    "processID": mainProcessID,
                    "error": "failed",
                    "errorDes": error?.localizedDescription
                ]
            ])
            trigger = nil
        }
    }
    
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        print("mosquito didFinishDownloadingTo process:\(mainProcessID)")
        
        do {
            if mainProcessID != "" {
                let data = try Data(contentsOf: location)
                
                if mainOptions.keys.contains("destination") {
                    let dest = mainOptions["destination"] as! String
                    let destDir = mainOptions["destinationDir"] as! String
                    try FileManager.default.createDirectory(at: URL(string:destDir)!, withIntermediateDirectories: true, attributes: nil)
                    try data.write(to: URL(string: dest)!)
                    
                    trigger!([
                        "mt-download-status", [
                            "processID": mainProcessID,
                            "result": "{\"file\": \"\(dest)\"}"
                        ]
                    ])
                }else{
                    let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                    let urlName = mainOptions["urlName"] as! String
                    let destDir = documentsURL.appendingPathComponent("mosquito-transport")
                    try FileManager.default.createDirectory(at: destDir, withIntermediateDirectories: true, attributes: nil)
                    let destURL = destDir.appendingPathComponent("\(NSDate().timeIntervalSince1970)-\(urlName)")
                    try data.write(to: destURL)
                    
                    trigger!([
                        "mt-download-status", [
                            "processID": mainProcessID,
                            "result": "{\"file\": \"\(destURL.absoluteString)\"}"
                        ]
                    ])
                }
            }
        } catch {
            print("downloadWrite err:", error)
            if mainProcessID != "" {
                trigger!([
                    "mt-download-status",[
                        "processID": mainProcessID,
                        "error": "saving_file_error",
                        "errorDes": "\(error)"
                    ]
                ])
            }
        }
        trigger = nil
    }
    
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        print("mosquito nativeProgress :\(Float(bytesWritten))")
        
        trigger!([
            "mt-download-progress", [
                "receivedBtyes": Float(totalBytesWritten),
                "expectedBytes": Float(totalBytesExpectedToWrite),
                "processID": mainProcessID
            ]
        ])
    }
    
    //    func getSystemFreeSpace(){
    //        do{
    //            let path = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)
    //            let dic = try FileManager.default.attributesOfFileSystem(forPath: path.last!)
    //
    //            let freeSpace =  dic[FileAttributeKey.systemFreeSize] as! CUnsignedLongLong
    //        }catch{
    //
    //        }
    //    }
}
