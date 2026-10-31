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
fetch pose_landmarker_lite.task "$base/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
fetch hair_segmenter.tflite "$base/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite"
# The live camera checks show the fake camera a gently moving portrait (the app's own sample).
if command -v ffmpeg >/dev/null && [ ! -s tests/.assets/face.y4m ]; then
  ffmpeg -loglevel error -y -loop 1 -i public/samples/demo-v2/original.png -t 3 -r 15 \
    -vf "scale=720:-2,crop=720:960:0:'(ih-960)/2+10*sin(2*PI*t/3)',format=yuv420p" tests/.assets/face.y4m
fi
echo "Ready. Optional: set GLOW_TEST_FACE=/path/to/portrait.jpg to also run the face-tool checks."
