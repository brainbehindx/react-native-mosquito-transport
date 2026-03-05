import React

@objc
public protocol NativeMosquitoTransportImplDelegate {
    func sendEvent(name: String, body: Any)
}

@objc(NativeMosquitoTransportImpl)
public class NativeMosquitoTransportImpl: NSObject, URLSessionDataDelegate {
    // Add property for the Objective-C bridge
    @objc public weak var delegate: NativeMosquitoTransportImplDelegate? = nil
    
    public override init() {
        super.init()
    }

    private func emitNewEvent(name: String, body: Any? = nil) {
        delegate?.sendEvent(name: name, body: body ?? [])
    }
    
    var uploadTask: [String: MosquitoTransportUploadTask] = [:]
    
    @objc(uploadFile:)
    public func uploadFile(options: [String: Any]) -> Void {
        let processID = options["processID"] as! String
        
        uploadTask[processID] = MosquitoTransportUploadTask()
        uploadTask[processID]?.uploadFile(options: options, completion: { res in
            let status = res![0] as? String
            
            self.emitNewEvent(name: status!, body: res![1])
            if status == "mt-uploading-status" {
                self.uploadTask.removeValue(forKey: processID)
            }
        })
    }
    
    @objc(cancelUpload:)
    public func cancelUpload (processID: String)-> Void {
        uploadTask[processID]?.cancelUpload()
    }
    
    var downloadTask: [String: MosquitoTransportDownloadTask] = [:]
    
    @objc(downloadFile:)
    public func downloadFile(options: [String: Any]) -> Void {
        let processID = options["processID"] as! String
        downloadTask[processID] = MosquitoTransportDownloadTask()
        downloadTask[processID]?.downloadFile(options: options, completion: { res in
            let status = res![0] as? String
            
            self.emitNewEvent(name: status!, body: res![1])
            if status == "mt-download-status" {
                self.downloadTask.removeValue(forKey: processID)
            }
        })
    }
    
    @objc(cancelDownload:)
    public func cancelDownload (processID: String)-> Void {
        downloadTask[processID]?.cancelDownload()
    }
    
    @objc(pauseDownload:)
    public func pauseDownload (processID: String)-> Void {
        downloadTask[processID]?.pauseDownload()
    }
    
    @objc(resumeDownload:)
    public func resumeDownload (processID: String)-> Void {
        downloadTask[processID]?.resumeDownload()
    }
}

class MosquitoTransportUploadTask: NSObject, URLSessionDataDelegate {
    
    var mainProcessID: String = ""
    var mainTask : URLSessionUploadTask? = nil
    var mainOptions: [String: Any] = [:]
    var trigger: (([Any]?)->())? = nil
    
    
    func uploadFile(options: [String: Any], completion: @escaping ([Any]?)->()) -> Void {
        let processID = options["processID"] as! String
        let filepath = options["file"] as! String
        let url = options["url"] as! String
        let destination = options["destination"] as! String
        
        do {
            let rawData = try Data(contentsOf: URL(fileURLWithPath: filepath))
            
            var request = URLRequest(url: URL(string: url)!)
            request.httpMethod = "POST"

            if let extraHeaders = options["extraHeaders"] as? [String: String] {
                for (key, value) in extraHeaders {
                    request.setValue(value, forHTTPHeaderField: key)
                }
            }
            if options["authToken"] != nil {
                request.setValue(options["authToken"] as? String, forHTTPHeaderField: "mtoken")
            }
            request.setValue(options["createHash"] as? String, forHTTPHeaderField: "hash-upload");
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
                "sentBytes": Float(totalBytesSent),
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


class MosquitoTransportDownloadTask: NSObject, URLSessionDownloadDelegate {
    
    var mainProcessID: String = ""
    var mainTask : URLSessionDownloadTask? = nil
    var mainOptions: [String: Any] = [:]
    var trigger: (([Any]?)->())? = nil
    
    func downloadFile(options: [String: Any], completion: @escaping ([Any]?)->()) -> Void {
        let processID = options["processID"] as! String
        let url = options["url"] as! String
        
        var request = URLRequest(url: URL(string: url)!)
        request.httpMethod = "POST"

        if let extraHeaders = options["extraHeaders"] as? [String: String] {
            for (key, value) in extraHeaders {
                request.setValue(value, forHTTPHeaderField: key)
            }
        }
        if options["authToken"] != nil {
            request.setValue(options["authToken"] as? String, forHTTPHeaderField: "mtoken")
        }
        
        let session = URLSession(configuration: URLSessionConfiguration.default, delegate: self, delegateQueue: nil)
        let task = session.downloadTask(with: request)
        
        mainProcessID = processID
        mainTask = task
        mainOptions = options
        trigger = completion
        task.resume()
        print("MosquitoTransportDownloadTask started:\(mainProcessID)")
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
                } else {
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
