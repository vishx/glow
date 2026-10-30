#!/usr/bin/env bash
# Copies the web app into www/ and bundles the on-device AI files so the
# phone app works without loading them from a CDN.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf www && mkdir -p www/vendor/mediapipe/wasm
cp -R ../public/. www/
cp node_modules/@mediapipe/tasks-vision/vision_bundle.mjs www/vendor/mediapipe/
cp node_modules/@mediapipe/tasks-vision/wasm/* www/vendor/mediapipe/wasm/
curl -fsSL -o www/vendor/selfie_segmenter.tflite \
  https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
curl -fsSL -o www/vendor/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
curl -fsSL -o www/vendor/pose_landmarker_lite.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
curl -fsSL -o www/vendor/hair_segmenter.tflite \
  https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite
echo "www/ is ready"
