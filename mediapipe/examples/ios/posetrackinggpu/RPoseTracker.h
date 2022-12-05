#import <Foundation/Foundation.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreMedia/CoreMedia.h>


@class Landmark;
@class RPoseTracker;

@protocol RPoseTrackerDelegate <NSObject>
- (void)rPoseTracker: (RPoseTracker *)tracker didOutputLandmarks: (NSArray<Landmark *> *)landmarks timestamp:(int64_t)timestamp;//Microseconds;
- (void)rPoseTracker: (RPoseTracker *)tracker didOutputPixelBuffer: (CVPixelBufferRef)pixelBuffer timestamp:(int64_t)timestamp;
@end

@interface RPoseTracker : NSObject
- (instancetype)init;
- (void)startGraph;
- (void)sendPixelBuffer:(CVPixelBufferRef)pixelBuffer timestamp:(CMTime)timestamp;
@property (weak, nonatomic) id <RPoseTrackerDelegate> delegate;
@end

@interface Landmark: NSObject
@property(nonatomic, readonly) float x;
@property(nonatomic, readonly) float y;

@end
