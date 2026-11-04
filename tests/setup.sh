#!/usr/bin/env bash
# One-time setup for `npm test`: the MediaPipe library and the four on-device models,
# served to the app by the test harness instead of the CDN. Playwright with Chromium must
# already be installed (`npx playwright install chromium` on a new machine).
set -euo pipefail
cd "$(dirname "$0")/.."
npm install --no-save @mediapipe/tasks-vision@0.10.14
mkdir -p tests/.assets
base=https://storage.googleapis.com/mediapipe-models
fetch() { [ -s "tests/.assets/$1" ] || curl -fsSL -o "tests/.assets/$1" "$2"; }
fetch selfie_segmenter.tflite "$base/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite"
fetch face_landmarker.task "$base/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
fetch gesture_recognizer.task "$base/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"
fetch blaze_face_short_range.tflite "$base/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
fetch pose_landmarker_lite.task "$base/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
fetch hair_segmenter.tflite "$base/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite"
fetch magic_touch.tflite "$base/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite"
fetch efficientdet_lite0.tflite "$base/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite"
# The live camera checks show the fake camera a gently moving portrait (the app's own sample).
if command -v ffmpeg >/dev/null && [ ! -s tests/.assets/face.y4m ]; then
  ffmpeg -loglevel error -y -loop 1 -i public/samples/demo-v2/original.png -t 3 -r 15 \
    -vf "scale=720:-2,crop=720:960:0:'(ih-960)/2+10*sin(2*PI*t/3)',format=yuv420p" tests/.assets/face.y4m
fi
# Show palm checks: an open hand (fingers up) and a fist, from MediaPipe's own test pictures.
fetch right_hands.jpg https://storage.googleapis.com/mediapipe-assets/right_hands.jpg
fetch fist.jpg https://storage.googleapis.com/mediapipe-assets/fist.jpg
if command -v ffmpeg >/dev/null && [ ! -s tests/.assets/palm.y4m ]; then
  ffmpeg -loglevel error -y -loop 1 -i tests/.assets/right_hands.jpg -t 3 -r 15 \
    -vf "crop=340:382:370:0,scale=400:-2,pad=720:960:280:180:0xd8d2c8,format=yuv420p" tests/.assets/palm.y4m
fi
if command -v ffmpeg >/dev/null && [ ! -s tests/.assets/fist.y4m ]; then
  ffmpeg -loglevel error -y -loop 1 -i tests/.assets/fist.jpg -t 3 -r 15 \
    -vf "scale=720:-2,pad=720:960:0:(oh-ih)/2:0xd8d2c8,format=yuv420p" tests/.assets/fist.y4m
fi
# Show palm from a distance: the portrait small (as if 2 m away) with a small open hand up beside
# the head, ~9% of the frame tall: too small to find in the whole frame, found in a close-up.
if command -v ffmpeg >/dev/null && [ ! -s tests/.assets/palmfar.y4m ]; then
  ffmpeg -loglevel error -y -f lavfi -i "color=c=0xd8d2c8:s=720x960:r=15:d=3" -loop 1 -i public/samples/demo-v2/original.png -loop 1 -i tests/.assets/right_hands.jpg \
    -filter_complex "[1]scale=720:-2,crop=720:960:0:(ih-960)/2,scale=288:384[f];[2]crop=340:382:370:0,scale=-2:86[h];[0][f]overlay=216:100[a];[a][h]overlay=476:178,format=yuv420p" \
    -t 3 -r 15 tests/.assets/palmfar.y4m
fi
echo "Ready. Optional: set GLOW_TEST_FACE=/path/to/portrait.jpg to also run the face-tool checks."
