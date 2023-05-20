#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(Mosquitodb, NSObject)

RCT_EXTERN_METHOD(uploadFile:(NSDictionary *)options)

RCT_EXTERN_METHOD(cancelUpload:(NSString *)processID)

RCT_EXTERN_METHOD(downloadFile:(NSDictionary *)options)

RCT_EXTERN_METHOD(cancelDownload:(NSString *)processID)

RCT_EXTERN_METHOD(pauseDownload:(NSString *)processID)

RCT_EXTERN_METHOD(resumeDownload:(NSString *)processID)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}
@end

