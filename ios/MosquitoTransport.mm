#import "MosquitoTransport.h"
#import <React/RCTEventEmitter.h>
#import <mach/mach_time.h>
#if __has_include("MosquitoTransport-Swift.h")
#import "MosquitoTransport-Swift.h"
#else
#import "MosquitoTransport/MosquitoTransport-Swift.h"
#endif

@interface MosquitoTransport () <NativeMosquitoTransportImplDelegate>
@end

@implementation MosquitoTransport {
  NativeMosquitoTransportImpl *nativeMosquitoTransport;
}

RCT_EXPORT_MODULE()

- (instancetype) init {
  self = [super init];
  if (self) {
    nativeMosquitoTransport = [NativeMosquitoTransportImpl new];
    // Critical: Register ourselves as the Objective-C bridge's event emitter
    nativeMosquitoTransport.delegate = self;
  }
  return self;
}

// event listeners
- (void)sendEvent:(NSString *)name body:(id)body {
  [super sendEventWithName:name body:body];
}

- (NSArray<NSString *> *)supportedEvents {
  return @[
    @"mt-uploading-progress",
    @"mt-uploading-status",
    @"mt-download-progress",
    @"mt-download-status"
  ];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeMosquitoTransportSpecJSI>(params);
}

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (void)getSystemUptime:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  static mach_timebase_info_data_t timebase;
  if (timebase.denom == 0) {
    mach_timebase_info(&timebase);
  }

  uint64_t time = mach_continuous_time();

  uint64_t nanos = time * timebase.numer / timebase.denom;

  double milliseconds = (double)nanos / 1e6;

  resolve(@(milliseconds));
}

- (void)uploadFile:(NSDictionary *)options {
  [nativeMosquitoTransport uploadFile:options];
}

- (void)cancelUpload:(NSString *)processID {
  [nativeMosquitoTransport cancelUpload:processID];
}

- (void)downloadFile:(NSDictionary *)options {
  [nativeMosquitoTransport downloadFile:options];
}

- (void)cancelDownload:(NSString *)processID {
  [nativeMosquitoTransport cancelDownload:processID];
}

- (void)pauseDownload:(NSString *)processID {
  [nativeMosquitoTransport pauseDownload:processID];
}

- (void)resumeDownload:(NSString *)processID {
  [nativeMosquitoTransport resumeDownload:processID];
}

@end
