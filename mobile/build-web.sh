#!/usr/bin/env bash
# Copies the web app into www/ and bundles the on-device AI files so the
# phone app works without loading them from a CDN.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf www && mkdir -p www/vendor/mediapipe/wasm
cp -R ../public/. www/
rm -rf www/app-update   # the live-update manifest is for the website, not the bundle
cp node_modules/@mediapipe/tasks-vision/vision_bundle.mjs www/vendor/mediapipe/
cp node_modules/@mediapipe/tasks-vision/vision_bundle.cjs www/vendor/mediapipe/   # for the live camera's face worker
cp node_modules/@mediapipe/tasks-vision/wasm/* www/vendor/mediapipe/wasm/
curl -fsSL -o www/vendor/selfie_segmenter.tflite \
  https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
curl -fsSL -o www/vendor/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
curl -fsSL -o www/vendor/blaze_face_short_range.tflite \
  https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite
curl -fsSL -o www/vendor/pose_landmarker_lite.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
curl -fsSL -o www/vendor/hair_segmenter.tflite \
  https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite
curl -fsSL -o www/vendor/magic_touch.tflite \
  https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite
curl -fsSL -o www/vendor/efficientdet_lite0.tflite \
  https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite
# The version id of these built-in screens, so live updates know what the phone already has.
node live-update.mjs --builtin
echo "www/ is ready"
