package com.vishx.glow.camera;

import android.Manifest;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.opengl.GLSurfaceView;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.hardware.camera2.CaptureRequest;
import android.os.Build;
import android.os.PowerManager;
import android.util.Range;
import android.util.Size;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.camera.camera2.interop.Camera2Interop;
import androidx.camera.camera2.interop.ExperimentalCamera2Interop;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.resolutionselector.AspectRatioStrategy;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LifecycleOwner;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Glow Studio's native camera for the phone app. The camera picture is drawn natively, with the
 * live look, behind the (transparent) web page, so the web camera screen's buttons, looks and
 * sliders stay as they are. The shutter takes a real full-resolution photo.
 *
 * JS: Capacitor.Plugins.GlowCamera
 *   start({ facing: "user" | "environment", ...look }) -> { width, height, torch, cameras, facing }
 *   setLook({ look, color, wash, compare, posY, view })   stop()   setTorch({ on })   getLight() -> { light }
 *   capture({ ...look, processed, aspect }) -> { raw, processed?, width, height }   (file paths)
 *   events: "face" { ready, failed, seen, cy }
 */
@CapacitorPlugin(name = "GlowCamera", permissions = { @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera") })
public class GlowCameraPlugin extends Plugin {
    private static final String TAG = "GlowCamera";
    private static final int STILL_MAX = 4032;

    // The newest camera frame (RGBA, as the camera gives it), shared with the GL thread.
    final Object frameLock = new Object();
    ByteBuffer frameBuf;
    int bufW, bufH, texW, frameRot;
    boolean frameNew, hasFrame;

    volatile Look look = new Look();
    volatile boolean mirror = true;

    private FaceTracker tracker;
    private BeautyRenderer renderer;
    private GLSurfaceView glView;
    private ProcessCameraProvider provider;
    private Camera camera;
    private ImageCapture imageCapture;
    private ExecutorService analysisExec, captureExec;
    private final Handler main = new Handler(Looper.getMainLooper());
    private PluginCall pendingStart;
    private int cameraCount = 1;
    private volatile float light = 255;
    private long lightAt;
    private Bitmap detFull;
    private volatile boolean capturing;
    private int session;
    // What the web page last heard about the face.
    private boolean sentSeen, sentReady, sentFailed;
    private long faceSentAt;
    private volatile boolean forceFace;

    @Override public void load() {
        tracker = new FaceTracker(getContext());
        // When the phone gets warm, face tracking runs less often so it cools down instead of slowing to a crawl.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
                pm.addThermalStatusListener(ContextCompat.getMainExecutor(getContext()),
                    (status) -> FaceTracker.hot = status >= PowerManager.THERMAL_STATUS_MODERATE);
            } catch (Throwable t) { Log.w(TAG, "thermal", t); }
        }
        analysisExec = Executors.newSingleThreadExecutor();
        captureExec = Executors.newSingleThreadExecutor();
    }

    // ---------- Start and stop ----------

    @PluginMethod public void start(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) { requestPermissionForAlias("camera", call, "cameraPermission"); return; }
        begin(call);
    }

    @PermissionCallback private void cameraPermission(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) begin(call);
        else call.reject("Camera access is off", "denied");
    }

    @androidx.annotation.OptIn(markerClass = ExperimentalCamera2Interop.class)
    private void begin(PluginCall call) {
        final boolean wantFront = !"environment".equals(call.getString("facing", "user"));
        look = Look.from(call.getData());
        tracker.init(this::sendFace);
        main.post(() -> {
            final int my = ++session;
            if (pendingStart != null) { pendingStart.reject("Replaced by a newer start", "stopped"); pendingStart = null; }
            try {
                showView();
            } catch (Throwable t) {
                Log.e(TAG, "view", t);
                call.reject("Couldn't show the camera", "error");
                return;
            }
            ListenableFuture<ProcessCameraProvider> fut = ProcessCameraProvider.getInstance(getContext());
            fut.addListener(() -> {
                if (my != session) { call.reject("Stopped", "stopped"); return; }
                try {
                    provider = fut.get();
                    CameraSelector front = CameraSelector.DEFAULT_FRONT_CAMERA, back = CameraSelector.DEFAULT_BACK_CAMERA;
                    boolean hasFront = provider.hasCamera(front), hasBack = provider.hasCamera(back);
                    if (!hasFront && !hasBack) { hideView(); call.reject("No camera found", "none"); return; }
                    boolean useFront = wantFront ? hasFront : !hasBack;
                    mirror = useFront;
                    cameraCount = (hasFront ? 1 : 0) + (hasBack ? 1 : 0);

                    // Preview frames and photos are both 4:3, so they see the same part of the scene and the
                    // photo's crop matches what the screen showed (a 16:9 preview sees a different slice).
                    ResolutionSelector previewRes = new ResolutionSelector.Builder()
                        .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                        .setResolutionStrategy(new ResolutionStrategy(new Size(1280, 960), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                        .build();
                    ImageAnalysis.Builder ab = new ImageAnalysis.Builder()
                        .setResolutionSelector(previewRes)
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888);
                    // A steady 30 frames a second at most (60 only heats the phone); it may slow down in the dark for a brighter picture.
                    new Camera2Interop.Extender<>(ab).setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, new Range<>(15, 30));
                    ImageAnalysis analysis = ab.build();
                    analysis.setAnalyzer(analysisExec, this::onFrame);
                    ResolutionSelector stillRes = new ResolutionSelector.Builder()
                        .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                        .setResolutionStrategy(new ResolutionStrategy(new Size(STILL_MAX, 3024), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                        .build();
                    imageCapture = new ImageCapture.Builder()
                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                        .setResolutionSelector(stillRes)
                        .build();
                    provider.unbindAll();
                    synchronized (frameLock) { hasFrame = false; frameNew = false; }
                    camera = provider.bindToLifecycle((LifecycleOwner) getActivity(), useFront ? front : back, analysis, imageCapture);
                    pendingStart = call;
                    // A camera that never sends a frame is most likely held by another app.
                    main.postDelayed(() -> {
                        if (pendingStart == call && my == session) {
                            pendingStart = null;
                            stopCamera();
                            call.reject("The camera is busy", "busy");
                        }
                    }, 6000);
                } catch (Throwable t) {
                    Log.e(TAG, "bind", t);
                    stopCamera();
                    call.reject("Couldn't open the camera", "busy");
                }
            }, ContextCompat.getMainExecutor(getContext()));
        });
    }

    @PluginMethod public void stop(PluginCall call) {
        main.post(() -> {
            session++;
            if (pendingStart != null) { pendingStart.reject("Stopped", "stopped"); pendingStart = null; }
            stopCamera();
            call.resolve();
        });
    }

    private void stopCamera() {
        try { if (provider != null) provider.unbindAll(); } catch (Throwable t) { Log.w(TAG, "unbind", t); }
        camera = null;
        imageCapture = null;
        hideView();
        tracker.reset();
        synchronized (frameLock) { hasFrame = false; frameNew = false; }
    }

    @Override protected void handleOnDestroy() {
        main.post(this::stopCamera);
    }

    private void showView() {
        WebView web = getBridge().getWebView();
        ViewGroup parent = (ViewGroup) web.getParent();
        if (glView == null) {
            renderer = new BeautyRenderer(this, tracker);
            glView = new GLSurfaceView(getContext());
            glView.setEGLContextClientVersion(2);
            glView.setPreserveEGLContextOnPause(true);
            glView.setRenderer(renderer);
            glView.setRenderMode(GLSurfaceView.RENDERMODE_WHEN_DIRTY);
        }
        if (glView.getParent() == null) parent.addView(glView, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        glView.setVisibility(View.VISIBLE);
        // The page is see-through on the camera screen (html.native-cam), so the picture shows behind it.
        web.setBackgroundColor(Color.TRANSPARENT);
    }

    private void hideView() {
        WebView web = getBridge().getWebView();
        web.setBackgroundColor(Color.parseColor("#121014"));
        // Kept (just hidden) so the next start doesn't rebuild the view and recompile the shader.
        if (glView != null) glView.setVisibility(View.GONE);
    }

    void rendererFailed(String why) {
        JSObject o = new JSObject();
        o.put("text", "Native camera shader failed: " + why);
        notifyListeners("error", o);
    }

    // ---------- Frames ----------

    private void onFrame(@NonNull ImageProxy img) {
        try {
            ImageProxy.PlaneProxy pl = img.getPlanes()[0];
            int w = img.getWidth(), h = img.getHeight(), rs = pl.getRowStride(), rot = img.getImageInfo().getRotationDegrees();
            ByteBuffer src = pl.getBuffer().duplicate();
            src.rewind();
            int need = rs * h;
            synchronized (frameLock) {
                if (frameBuf == null || frameBuf.capacity() < need) frameBuf = ByteBuffer.allocateDirect(need).order(ByteOrder.nativeOrder());
                frameBuf.clear();
                if (src.remaining() > need) src.limit(src.position() + need);
                frameBuf.put(src);
                while (frameBuf.position() < need) frameBuf.put((byte) 0);   // the last row can come without its padding
                frameBuf.flip();
                bufW = w; bufH = h; texW = rs / 4; frameRot = rot;
                frameNew = true; hasFrame = true;
            }
            GLSurfaceView v = glView;
            if (v != null) v.requestRender();

            boolean side = rot % 180 != 0;
            int W = side ? h : w, H = side ? w : h;
            if (pendingStart != null) {
                final int fw = W, fh = H;
                main.post(() -> {
                    PluginCall c = pendingStart;
                    if (c == null) return;
                    pendingStart = null;
                    JSObject o = new JSObject();
                    o.put("width", fw); o.put("height", fh);
                    o.put("torch", camera != null && camera.getCameraInfo().hasFlashUnit());
                    o.put("cameras", cameraCount);
                    o.put("facing", mirror ? "user" : "environment");
                    c.resolve(o);
                    // A fresh page state: tell it about the face finder again.
                    forceFace = true;
                    sendFace();
                });
            }
            long now = SystemClock.uptimeMillis();
            if (now - lightAt > 400) { lightAt = now; light = measureLight(w, h, rs); }
            if (!look.needsFace()) {
                // The Original look needs no face tracking.
                if (tracker.snap().pts != null) { tracker.reset(); sendFace(); }
            } else if (tracker.canSend(now)) {
                Bitmap small = smallUpright(w, h, rs, rot);
                if (small != null) tracker.detect(small, W, H, this::sendFace);
            }
        } catch (Throwable t) {
            Log.w(TAG, "frame", t);
        } finally {
            img.close();
        }
    }

    /** A copy of the frame turned upright, at most 320 pixels on its long side (the model looks at a 256px face crop). */
    private Bitmap smallUpright(int w, int h, int rs, int rot) {
        int tw = rs / 4;
        if (detFull == null || detFull.getWidth() != tw || detFull.getHeight() != h) {
            if (detFull != null) detFull.recycle();
            detFull = Bitmap.createBitmap(tw, h, Bitmap.Config.ARGB_8888);
        }
        synchronized (frameLock) {
            ByteBuffer b = frameBuf.duplicate();
            b.position(0);
            detFull.copyPixelsFromBuffer(b);
        }
        Matrix m = new Matrix();
        float s = Math.min(1f, 320f / Math.max(w, h));
        m.postScale(s, s);
        m.postRotate(rot);
        return Bitmap.createBitmap(detFull, 0, 0, w, h, m, true);
    }

    /** Average brightness of the picture (0-255), from a 24×24 grid of samples. */
    private float measureLight(int w, int h, int rs) {
        double t = 0;
        synchronized (frameLock) {
            for (int y = 0; y < 24; y++) for (int x = 0; x < 24; x++) {
                int i = ((y * h / 24) * rs) + (x * w / 24) * 4;
                t += 0.299 * (frameBuf.get(i) & 255) + 0.587 * (frameBuf.get(i + 1) & 255) + 0.114 * (frameBuf.get(i + 2) & 255);
            }
        }
        return (float) (t / 576);
    }

    /** Tells the page whether a face is in view (for the Adjust panel's notes) and where (to keep it in sight). */
    private synchronized void sendFace() {
        FaceTracker.Snap s = tracker.snap();
        boolean seen = s.seen > 0 && s.pts != null;
        long now = SystemClock.uptimeMillis();
        boolean changed = seen != sentSeen || tracker.ready != sentReady || tracker.failed != sentFailed;
        if (!changed && !forceFace && !(seen && now - faceSentAt > 150)) return;
        forceFace = false;
        sentSeen = seen; sentReady = tracker.ready; sentFailed = tracker.failed; faceSentAt = now;
        JSObject o = new JSObject();
        o.put("ready", tracker.ready);
        o.put("failed", tracker.failed);
        if (tracker.failed) o.put("error", tracker.error);
        o.put("seen", seen);
        if (seen && s.H > 0) o.put("cy", (s.pts[FaceGeometry.BROW * 2 + 1] + s.pts[FaceGeometry.CHIN * 2 + 1]) / 2 / s.H);
        notifyListeners("face", o);
    }

    // ---------- Settings ----------

    @PluginMethod public void setLook(PluginCall call) {
        look = Look.from(call.getData());
        call.resolve();
    }

    @PluginMethod public void setTorch(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        main.post(() -> {
            if (camera == null || !camera.getCameraInfo().hasFlashUnit()) { call.reject("No flash"); return; }
            camera.getCameraControl().enableTorch(on);
            call.resolve();
        });
    }

    @PluginMethod public void getLight(PluginCall call) {
        JSObject o = new JSObject();
        o.put("light", light);
        call.resolve(o);
    }

    // ---------- Shutter ----------

    @PluginMethod public void capture(PluginCall call) {
        final Look lk = Look.from(call.getData());
        final boolean processed = Boolean.TRUE.equals(call.getBoolean("processed", true));
        final double aspect = call.getDouble("aspect", 0d);
        main.post(() -> {
            ImageCapture ic = imageCapture;
            if (ic == null || capturing) { call.reject("The camera isn't ready"); return; }
            capturing = true;
            final boolean mir = mirror;
            ic.takePicture(captureExec, new ImageCapture.OnImageCapturedCallback() {
                @Override public void onCaptureSuccess(@NonNull ImageProxy image) {
                    byte[] jpeg;
                    int rot;
                    try {
                        ByteBuffer b = image.getPlanes()[0].getBuffer();
                        b.rewind();
                        jpeg = new byte[b.remaining()];
                        b.get(jpeg);
                        rot = image.getImageInfo().getRotationDegrees();
                    } catch (Throwable t) {
                        capturing = false;
                        call.reject("Couldn't take the photo.");
                        return;
                    } finally {
                        image.close();
                    }
                    try { finish(call, jpeg, rot, mir, lk, processed, aspect); }
                    catch (Throwable t) { Log.e(TAG, "capture", t); call.reject("Couldn't take the photo."); }
                    finally { capturing = false; }
                }
                @Override public void onError(@NonNull ImageCaptureException e) {
                    capturing = false;
                    Log.e(TAG, "takePicture", e);
                    call.reject("Couldn't take the photo.");
                }
            });
        });
    }

    /** Upright, cropped to what the screen showed, mirrored like the preview; the look baked into a second copy. */
    private void finish(PluginCall call, byte[] jpeg, int rot, boolean mir, Look lk, boolean processed, double aspect) throws Exception {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, o);
        int sample = 1;
        while (Math.max(o.outWidth, o.outHeight) / (sample * 2) >= STILL_MAX) sample *= 2;
        o = new BitmapFactory.Options();
        o.inSampleSize = sample;
        o.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap dec = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, o);
        if (dec == null) throw new IllegalStateException("decode");
        int maxSide = STILL_MAX;
        BeautyRenderer r0 = renderer;
        if (processed && r0 != null) maxSide = Math.min(maxSide, r0.maxTex);
        float s = Math.min(1f, (float) maxSide / Math.max(dec.getWidth(), dec.getHeight()));
        Matrix m = new Matrix();
        if (s < 1f) m.postScale(s, s);
        m.postRotate(rot);
        Bitmap up = Bitmap.createBitmap(dec, 0, 0, dec.getWidth(), dec.getHeight(), m, true);
        if (up != dec) dec.recycle();

        // The photo is what the screen showed: the full-screen preview's crop of the frame.
        int W = up.getWidth(), H = up.getHeight(), cw = W, ch = H;
        if (aspect > 0) {
            if ((double) W / H > aspect) cw = (int) Math.round(H * aspect); else ch = (int) Math.round(W / aspect);
        }
        cw = Math.max(1, Math.min(W, cw)); ch = Math.max(1, Math.min(H, ch));
        int cx = (W - cw) / 2, cy = Math.round((H - ch) * lk.posY);
        Bitmap crop = (cw == W && ch == H) ? up : Bitmap.createBitmap(up, cx, cy, cw, ch);
        if (crop != up) up.recycle();

        long stamp = System.currentTimeMillis();
        File dir = getContext().getCacheDir();
        File[] old = dir.listFiles((d, n) -> n.startsWith("glowcam-"));
        if (old != null) for (File f : old) if (stamp - f.lastModified() > 10 * 60 * 1000) f.delete();

        Bitmap raw = crop;
        if (mir) {
            Matrix flip = new Matrix();
            flip.preScale(-1, 1);
            raw = Bitmap.createBitmap(crop, 0, 0, cw, ch, flip, false);
        }
        File rawFile = new File(dir, "glowcam-" + stamp + "-raw.jpg");
        save(raw, rawFile);
        if (raw != crop) raw.recycle();

        File procFile = null;
        if (processed) {
            float sm = Math.min(1f, 960f / Math.max(cw, ch));
            Bitmap small = Bitmap.createScaledBitmap(crop, Math.max(1, Math.round(cw * sm)), Math.max(1, Math.round(ch * sm)), true);
            float[] P = tracker.detectStill(small, cw, ch);
            if (small != crop) small.recycle();
            final Bitmap[] out = new Bitmap[1];
            GLSurfaceView v = glView;
            BeautyRenderer r = renderer;
            if (v != null && r != null) {
                CountDownLatch done = new CountDownLatch(1);
                final Bitmap still = crop;
                v.queueEvent(() -> { try { out[0] = r.renderStill(still, P, lk, mir); } finally { done.countDown(); } });
                done.await(15, TimeUnit.SECONDS);
            }
            if (out[0] != null) {
                procFile = new File(dir, "glowcam-" + stamp + ".jpg");
                save(out[0], procFile);
                out[0].recycle();
            }
        }
        crop.recycle();
        JSObject res = new JSObject();
        res.put("raw", rawFile.getAbsolutePath());
        if (procFile != null) res.put("processed", procFile.getAbsolutePath());
        res.put("width", cw);
        res.put("height", ch);
        call.resolve(res);
    }

    private static void save(Bitmap b, File f) throws Exception {
        try (FileOutputStream out = new FileOutputStream(f)) { b.compress(Bitmap.CompressFormat.JPEG, 92, out); }
    }
}
