#import "RPoseTracker.h"
#import "mediapipe/objc/MPPGraph.h"
#import "mediapipe/objc/MPPCameraInputSource.h"
#import "mediapipe/objc/MPPLayerRenderer.h"
#include "mediapipe/framework/formats/landmark.pb.h"

static NSString* const kGraphName = @"pose_tracking_gpu";
static const char* kInputStream = "input_video";
static const char* kOutputStream = "output_video";
static const char* kLandmarksOutputStream = "pose_landmarks";
static const char* kVideoQueueLabel = "com.google.mediapipe.example.videoQueue";

@interface RPoseTracker() <MPPGraphDelegate>
@property(nonatomic) MPPGraph* mediapipeGraph;
@end

@interface Landmark()
- (instancetype)initWithX:(float)x y:(float)y z:(float)z visibility:(float)visibility presence:(float)presence;
@end

@implementation RPoseTracker {}

#pragma mark - Cleanup methods

- (void)dealloc {
    self.mediapipeGraph.delegate = nil;
    [self.mediapipeGraph cancel];
    // Ignore errors since we're cleaning up.
    [self.mediapipeGraph closeAllInputStreamsWithError:nil];
    [self.mediapipeGraph waitUntilDoneWithError:nil];
}

#pragma mark - MediaPipe graph methods
+ (MPPGraph*)loadGraphFromResource:(NSString*)resource {
    // Load the graph config resource.
    NSError* configLoadError = nil;
    NSBundle* bundle = [NSBundle bundleForClass:[self class]];
    if (!resource || resource.length == 0) {
        return nil;
    }
    NSURL* graphURL = [bundle URLForResource:resource withExtension:@"binarypb"];
    NSData* data = [NSData dataWithContentsOfURL:graphURL options:0 error:&configLoadError];
    if (!data) {
        NSLog(@"Failed to load MediaPipe graph config: %@", configLoadError);
        return nil;
    }
    
    // Parse the graph config resource into mediapipe::CalculatorGraphConfig proto object.
    mediapipe::CalculatorGraphConfig config;
    config.ParseFromArray(data.bytes, data.length);
    
    // Create MediaPipe graph with mediapipe::CalculatorGraphConfig proto object.
    MPPGraph* newGraph = [[MPPGraph alloc] initWithGraphConfig:config];
    [newGraph addFrameOutputStream:kOutputStream outputPacketType:MPPPacketTypePixelBuffer];
    [newGraph addFrameOutputStream:kLandmarksOutputStream outputPacketType:MPPPacketTypeRaw];
    return newGraph;
}

- (instancetype)init
{
    self = [super init];
    if (self) {
        self.mediapipeGraph = [[self class] loadGraphFromResource:kGraphName];
        self.mediapipeGraph.delegate = self;
        // Set maxFramesInFlight to a small value to avoid memory contention for real-time processing.
        self.mediapipeGraph.maxFramesInFlight = 2;
    }
    return self;
}

- (void)startGraph {
    // Start running self.mediapipeGraph.
    NSError* error;
    if (![self.mediapipeGraph startWithError:&error]) {
        NSLog(@"Failed to start graph: %@", error);
    }
}

#pragma mark - MPPGraphDelegate methods

// Receives CVPixelBufferRef from the MediaPipe graph. Invoked on a MediaPipe worker thread.
- (void)mediapipeGraph:(MPPGraph*)graph
  didOutputPixelBuffer:(CVPixelBufferRef)pixelBuffer
            fromStream:(const std::string&)streamName
            timestamp:(const mediapipe::Timestamp &)timestamp{
      if (streamName == kOutputStream) {
          [_delegate rPoseTracker: self didOutputPixelBuffer: pixelBuffer timestamp:timestamp.Microseconds()];
      }
}

// Receives a raw packet from the MediaPipe graph. Invoked on a MediaPipe worker thread.
- (void)mediapipeGraph:(MPPGraph*)graph
      didOutputPacket:(const ::mediapipe::Packet&)packet
            fromStream:(const std::string&)streamName {

    if (streamName == kLandmarksOutputStream) {
        if (packet.IsEmpty()) { return; }
        const auto& landmarks = packet.Get<::mediapipe::NormalizedLandmarkList>();
        NSMutableArray<Landmark *> *result = [NSMutableArray array];
        NSArray *indexNeeds = @[@16, @14, @12, @11, @13, @15, @24, @26, @28, @23, @25, @27];
        for (NSNumber *i in indexNeeds) {
            Landmark *landmark = [[Landmark alloc] initWithX:landmarks.landmark(i).x()
                                                          y:landmarks.landmark(i).y()];
            [result addObject:landmark];
        }
        [_delegate rPoseTracker: self didOutputLandmarks: result timestamp:packet.Timestamp().Microseconds()];
    }
}

- (void)sendPixelBuffer:(CVPixelBufferRef)pixelBuffer timestamp:(CMTime)timestamp{
    
    mediapipe::Timestamp graphTimestamp(mediapipe::TimestampBaseType(
    mediapipe::Timestamp::kTimestampUnitsPerSecond * CMTimeGetSeconds(timestamp)));
    
    [self.mediapipeGraph sendPixelBuffer:pixelBuffer
                              intoStream:kInputStream
                              packetType:MPPPacketTypePixelBuffer
                              timestamp:graphTimestamp];
}

@end


@implementation Landmark

- (instancetype)initWithX:(float)x y:(float)y
{
    self = [super init];
    if (self) {
        _x = x;
        _y = y;
    }
    return self;
}

@end
