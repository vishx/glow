#!/usr/bin/env node
// Live updates for the phone app (self-hosted, no paid service).
//
// The phone app ships with its screens built in (mobile/www). On every open, public/liveupdate.js
// reads public/app-update/manifest.json from the live site and, when it names a newer version,
// asks the updater plugin (@capgo/capacitor-updater, open source, used in manual mode) to fetch
// it. The manifest lists every file of the bundle with its SHA-256, so a phone only downloads the
// files that changed: anything identical to what is built into the APK, or to a file it already
// downloaded, is copied on the phone. The plugin checks each hash before using a file, and rolls
// back to the previous screens if a new version doesn't report "started fine" (notifyAppReady).
//
// Usage (from mobile/, after `bash build-web.sh` has filled www/):
//   node live-update.mjs            writes ../public/app-update/manifest.json (commit it with the release)
//   node live-update.mjs --builtin  writes www/bundle-version.json (build-web.sh runs this for the APK)
//   node live-update.mjs --check    fails if the committed manifest doesn't match public/ (release check)
//
// When a release changes native code (a plugin, a permission, Java/Swift), raise MIN_NATIVE for
// that platform together with versionCode (android/app/build.gradle) or CURRENT_PROJECT_VERSION
// (iOS). Phones with an older app then keep their screens and are asked to update from the store.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WWW = join(HERE, "www");
const PUBLIC = join(HERE, "..", "public");
const OUT = join(PUBLIC, "app-update", "manifest.json");
const SITE = "https://glow-photo-enhancer.vercel.app";

// The native app build each platform needs for these screens (Android versionCode, iOS build).
export const MIN_NATIVE = { android: 4, ios: 2 };

// Files that are never part of a phone bundle.
const SKIP = (rel) => rel === "bundle-version.json" || rel.startsWith("app-update/") || rel.endsWith(".DS_Store");

// build-web.sh adds these to www/ from npm and Google; the phone fetches them from the same place
// if the copy built into its APK is different (it almost never is).
const MP = JSON.parse(readFileSync(join(HERE, "node_modules/@mediapipe/tasks-vision/package.json"), "utf8")).version;
const VENDOR_URLS = {
  "vendor/selfie_segmenter.tflite": "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
  "vendor/face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "vendor/blaze_face_short_range.tflite": "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
  "vendor/pose_landmarker_lite.task": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  "vendor/hair_segmenter.tflite": "https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite",
  "vendor/magic_touch.tflite": "https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite",
  "vendor/efficientdet_lite0.tflite": "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
};
const vendorUrl = (rel) => {
  if (VENDOR_URLS[rel]) return VENDOR_URLS[rel];
  if (rel.startsWith("vendor/mediapipe/")) return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP}/${rel.slice("vendor/mediapipe/".length)}`;
  return null;
};

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).split(sep).join("/"));
  }
  return out;
}
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const appBuild = () => Number(/const APP_BUILD = (\d+);/.exec(readFileSync(join(PUBLIC, "features.js"), "utf8"))[1]);

// Every file of the bundle with its hash, and a version id that changes whenever any file does.
function bundle() {
  if (!existsSync(join(WWW, "index.html"))) throw new Error("mobile/www is empty: run `bash build-web.sh` first");
  // The screens come straight from public/ (what the website serves), the on-device AI files from
  // www/ (what build-web.sh added), so a stale www/ can't put old screens in the manifest.
  const pub = walk(PUBLIC).filter((rel) => !SKIP(rel));
  const extra = walk(WWW).filter((rel) => !SKIP(rel) && !existsSync(join(PUBLIC, rel)));
  const files = [
    ...pub.map((rel) => ({ file_name: rel, file_hash: sha(join(PUBLIC, rel)), download_url: `${SITE}/${rel.split("/").map(encodeURIComponent).join("/")}` })),
    ...extra.map((rel) => {
      const url = vendorUrl(rel);
      if (!url) throw new Error(`No download address for ${rel}: add it to VENDOR_URLS`);
      return { file_name: rel, file_hash: sha(join(WWW, rel)), download_url: url };
    }),
  ].sort((a, b) => (a.file_name < b.file_name ? -1 : 1));
  const build = appBuild();
  const digest = createHash("sha256").update(files.map((f) => f.file_name + ":" + f.file_hash).join("\n")).digest("hex").slice(0, 10);
  return { version: `${build}-${digest}`, build, files };
}

const mode = process.argv[2] || "";
const b = bundle();
if (mode === "--builtin") {
  writeFileSync(join(WWW, "bundle-version.json"), JSON.stringify({ version: b.version, build: b.build }) + "\n");
  console.log(`www/bundle-version.json: ${b.version}`);
} else if (mode === "--check") {
  const m = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  if (!m || m.version !== b.version) {
    console.error(`public/app-update/manifest.json is out of date (${m ? m.version : "missing"}, should be ${b.version}). Run: cd mobile && bash build-web.sh && node live-update.mjs`);
    process.exit(1);
  }
  console.log(`manifest up to date: ${b.version}`);
} else {
  const manifest = { version: b.version, build: b.build, minNative: MIN_NATIVE, created: new Date().toISOString(), files: b.files };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(manifest, null, 1) + "\n");
  console.log(`public/app-update/manifest.json: ${b.version}, ${b.files.length} files`);
}
