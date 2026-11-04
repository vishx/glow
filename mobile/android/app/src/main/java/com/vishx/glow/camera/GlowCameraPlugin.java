package com.vishx.glow.camera;

import android.Manifest;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.content.pm.ActivityInfo;
import android.graphics.Matrix;
import android.view.OrientationEventListener;
import android.view.Surface;
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
import android.content.Context;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.util.Rational;
import android.util.SizeF;
import androidx.camera.camera2.interop.Camera2CameraControl;
import androidx.camera.camera2.interop.Camera2CameraInfo;
import androidx.camera.camera2.interop.Camera2Interop;
import androidx.camera.camera2.interop.CaptureRequestOptions;
import androidx.camera.core.ExposureState;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.SurfaceOrientedMeteringPointFactory;
import androidx.camera.core.ZoomState;
import androidx.camera.extensions.ExtensionMode;
import androidx.camera.extensions.ExtensionsManager;
import com.getcapacitor.JSArray;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
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
 *   capture({ ...look, processed, aspect, crop? }) -> { raw, processed?, width, height }   (file paths)
 *   setZoom({ zoom })   focus({ x, y, lock } | { reset })   setExposure({ ev })   setFlash({ mode: "off" | "auto" | "on" })
 *   start also takes { hdr } and returns { zoomMin, zoomMax, lenses, ev: [min, max, step], focus, hdr }
 *   events: "face" { ready, failed, seen, cy }
 *   setPalm({ on })   -> events "palm" { hand: [score, x, y, w, h] | null } (upright, unmirrored frame, 0..1)
 *   setKeys({ mode: "shoot" | "zoom" | "volume" }) -> while the camera is open, events "key" { key: "up" | "down", repeat }
 *   setVoice({ on }) -> { ok } | { denied } | { unavailable }; events "voice" { text, id } | { error }
 */
@CapacitorPlugin(name = "GlowCamera", permissions = {
    @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera"),
    @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") })
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
    private PalmTracker palm;
    private boolean palmSeen;
    /** Where Show palm looks next: [x, y, w, h] of the upright picture (0..1), set by the page. */
    private volatile float[] palmRegion = { 0, 0, 1, 1 };
    private VoiceListener voice;   // main thread only
    /** The live camera plugin, for MainActivity's volume keys. */
    static volatile GlowCameraPlugin live;
    /** What the volume keys do while the camera is open: "shoot", "zoom" or "volume" (the phone's own). */
    private volatile String keyMode = "shoot";
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
    // Pro controls: the flash mode for photos, whether HDR was asked for and is on, the lenses.
    private int flashMode = ImageCapture.FLASH_MODE_AUTO;
    private boolean hdrOn, hdrAvailable;
    private ExtensionsManager extensions;

    // How the phone is held, like a phone's own camera: the camera screen stays upright (portrait)
    // and only the icons turn; a photo taken sideways is saved sideways (the page turns it), and
    // faces are looked for the right way up. 0, 90, 180 or 270: degrees the phone is turned
    // clockwise from upright (90 = its left side on top).
    private volatile int devDeg = 0;
    private OrientationEventListener tilt;
    private Integer lockedFrom;   // the screen orientation to go back to when the camera closes

    /** Degrees (clockwise) to turn the upright, unmirrored frame so a face in it stands upright. */
    private int faceTurn() { int d = devDeg; return mirror ? (360 - d) % 360 : d; }

    private void holdUpright(boolean on) {
        android.app.Activity a = getActivity();
        if (a == null) return;
        if (on) {
            if (lockedFrom == null) lockedFrom = a.getRequestedOrientation();
            a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
            if (tilt == null) {
                tilt = new OrientationEventListener(getContext()) {
                    @Override public void onOrientationChanged(int o) {
                        if (o == ORIENTATION_UNKNOWN) return;   // lying flat: keep the last one
                        int d = devDeg, diff = Math.abs(((o - d) % 360 + 540) % 360 - 180);
                        if (diff < 60) return;                  // a dead zone, so it doesn't flicker near 45°
                        int nd = ((o + 45) / 90 % 4) * 90;
                        if (nd == d) return;
                        devDeg = nd;
                        JSObject e = new JSObject();
                        e.put("deg", nd);
                        notifyListeners("orientation", e);
                    }
                };
            }
            if (tilt.canDetectOrientation()) tilt.enable();
        } else {
            if (tilt != null) tilt.disable();
            if (lockedFrom != null) { a.setRequestedOrientation(lockedFrom); lockedFrom = null; }
        }
    }

    @PluginMethod public void getOrientation(PluginCall call) {
        JSObject o = new JSObject(); o.put("deg", devDeg); call.resolve(o);
    }

    @Override public void load() {
        tracker = new FaceTracker(getContext());
        palm = new PalmTracker(getContext());
        live = this;
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
        final boolean wantHdr = Boolean.TRUE.equals(call.getBoolean("hdr", false));
        look = Look.from(call.getData());
        tracker.init(this::sendFace);
        main.post(() -> {
            final int my = ++session;
            if (pendingStart != null) { pendingStart.reject("Replaced by a newer start", "stopped"); pendingStart = null; }
            try {
                holdUpright(true);
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
                } catch (Throwable t) {
                    Log.e(TAG, "provider", t);
                    call.reject("Couldn't open the camera", "busy");
                    return;
                }
                if (extensions != null) { bind(call, my, wantFront, wantHdr); return; }
                // HDR comes from the phone maker's camera extensions, where the phone has them.
                try {
                    ListenableFuture<ExtensionsManager> ef = ExtensionsManager.getInstanceAsync(getContext(), provider);
                    ef.addListener(() -> {
                        try { extensions = ef.get(); } catch (Throwable t) { Log.w(TAG, "extensions", t); }
                        if (my != session) { call.reject("Stopped", "stopped"); return; }
                        bind(call, my, wantFront, wantHdr);
                    }, ContextCompat.getMainExecutor(getContext()));
                } catch (Throwable t) {
                    Log.w(TAG, "extensions", t);
                    bind(call, my, wantFront, wantHdr);
                }
            }, ContextCompat.getMainExecutor(getContext()));
        });
    }

    @androidx.annotation.OptIn(markerClass = ExperimentalCamera2Interop.class)
    private void bind(PluginCall call, int my, boolean wantFront, boolean wantHdr) {
                try {
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
                        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                        .setTargetRotation(Surface.ROTATION_0);   // frames and photos always come portrait-upright
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
                        .setTargetRotation(Surface.ROTATION_0)
                        .setFlashMode(flashMode)
                        .build();
                    provider.unbindAll();
                    synchronized (frameLock) { hasFrame = false; frameNew = false; }
                    CameraSelector sel = useFront ? front : back;
                    hdrAvailable = false; hdrOn = false;
                    try {
                        hdrAvailable = extensions != null && extensions.isExtensionAvailable(sel, ExtensionMode.HDR)
                            && extensions.isImageAnalysisSupported(sel, ExtensionMode.HDR);
                    } catch (Throwable t) { Log.w(TAG, "hdr check", t); }
                    camera = null;
                    if (wantHdr && hdrAvailable) {
                        try {
                            camera = provider.bindToLifecycle((LifecycleOwner) getActivity(), extensions.getExtensionEnabledCameraSelector(sel, ExtensionMode.HDR), analysis, imageCapture);
                            hdrOn = true;
                        } catch (Throwable t) {
                            // HDR wouldn't open with the live look's frames: the camera opens without it.
                            Log.w(TAG, "hdr bind", t);
                            provider.unbindAll();
                            hdrAvailable = false;
                        }
                    }
                    if (camera == null) camera = provider.bindToLifecycle((LifecycleOwner) getActivity(), sel, analysis, imageCapture);
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
        holdUpright(false);
        tracker.reset();
        palmSeen = false;
        if (voice != null) voice.setOn(false);
        synchronized (frameLock) { hasFrame = false; frameNew = false; }
    }

    @Override protected void handleOnPause() {
        super.handleOnPause();
        main.post(() -> { if (voice != null) voice.setOn(false); });   // the page turns it back on with the camera
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
                    putPro(o);
                    c.resolve(o);
                    // A fresh page state: tell it about the face finder again.
                    forceFace = true;
                    sendFace();
                });
            }
            long now = SystemClock.uptimeMillis();
            if (now - lightAt > 400) { lightAt = now; light = measureLight(w, h, rs); }
            if (!look.needsFace() && !palm.on) {
                // The Original look needs no face tracking.
                if (tracker.snap().pts != null) { tracker.reset(); sendFace(); }
            } else if (tracker.canSend(now)) {
                Bitmap small = smallUpright(w, h, rs, rot, 320);
                if (small != null) tracker.detect(small, W, H, faceTurn(), this::sendFace);
            }
            // Show palm: the part of the picture the page asked for, cut from the full-size frame,
            // so a far hand keeps its detail (the hand model shrinks what it's given to 192 px).
            if (palm.canSend(now) && !capturing) {
                final float[] r = palmRegion;
                Bitmap pb = uprightCrop(w, h, rs, rot, r, 480);
                if (pb != null) palm.detect(pb, faceTurn(), (hand) -> sendPalm(fromRegion(hand, r)));
            }
        } catch (Throwable t) {
            Log.w(TAG, "frame", t);
        } finally {
            img.close();
        }
    }

    /** A copy of the frame turned upright, at most `side` pixels on its long side (the face model looks at a 256px face crop). */
    private Bitmap smallUpright(int w, int h, int rs, int rot, int side) {
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
        float s = Math.min(1f, (float) side / Math.max(w, h));
        m.postScale(s, s);
        m.postRotate(rot);
        return Bitmap.createBitmap(detFull, 0, 0, w, h, m, true);
    }

    /** A part of the frame ([x, y, w, h] of the upright picture, 0..1), turned upright, at most `side` px. */
    private Bitmap uprightCrop(int w, int h, int rs, int rot, float[] r, int side) {
        if (r == null || r.length != 4 || (r[0] <= 0 && r[1] <= 0 && r[2] >= 1 && r[3] >= 1)) return smallUpright(w, h, rs, rot, side);
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
        // The region's corners in the camera's own (unturned) frame: upright = raw turned `rot` clockwise.
        float[] xs = new float[2], ys = new float[2];
        float[][] corners = { { r[0], r[1] }, { r[0] + r[2], r[1] + r[3] } };
        for (int i = 0; i < 2; i++) {
            float u = corners[i][0], v = corners[i][1];
            if (rot == 90) { xs[i] = v; ys[i] = 1 - u; }
            else if (rot == 180) { xs[i] = 1 - u; ys[i] = 1 - v; }
            else if (rot == 270) { xs[i] = 1 - v; ys[i] = u; }
            else { xs[i] = u; ys[i] = v; }
        }
        int x0 = Math.max(0, Math.round(Math.min(xs[0], xs[1]) * w)), y0 = Math.max(0, Math.round(Math.min(ys[0], ys[1]) * h));
        int x1 = Math.min(w, Math.round(Math.max(xs[0], xs[1]) * w)), y1 = Math.min(h, Math.round(Math.max(ys[0], ys[1]) * h));
        if (x1 - x0 < 16 || y1 - y0 < 16) return smallUpright(w, h, rs, rot, side);
        Matrix m = new Matrix();
        float s = Math.min(1f, (float) side / Math.max(x1 - x0, y1 - y0));
        m.postScale(s, s);
        m.postRotate(rot);
        return Bitmap.createBitmap(detFull, x0, y0, x1 - x0, y1 - y0, m, true);
    }

    /** A hand found in a crop, back in the whole upright picture. */
    private static float[] fromRegion(float[] hand, float[] r) {
        if (hand == null || r == null || r.length != 4) return hand;
        return new float[] { hand[0], r[0] + hand[1] * r[2], r[1] + hand[2] * r[3], hand[3] * r[2], hand[4] * r[3] };
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

    /** Tells the page about an open palm (every look while one is in view, and once when it goes). */
    /** Every look's answer goes to the page (it picks where the next look goes), with the face's box
     *  [x, y, w, h] of the upright picture (0..1) when the face finder has one. */
    private void sendPalm(float[] hand) {
        palmSeen = hand != null;
        JSObject o = new JSObject();
        o.put("hand", hand != null ? floats(hand) : JSObject.NULL);
        FaceTracker.Snap f = tracker.snap();
        if (f.pts != null && f.seen > 0 && f.W > 0 && f.H > 0) {
            float x0 = Float.MAX_VALUE, y0 = Float.MAX_VALUE, x1 = -Float.MAX_VALUE, y1 = -Float.MAX_VALUE;
            for (int i = 0; i + 1 < f.pts.length; i += 2) {
                x0 = Math.min(x0, f.pts[i]); x1 = Math.max(x1, f.pts[i]); y0 = Math.min(y0, f.pts[i + 1]); y1 = Math.max(y1, f.pts[i + 1]);
            }
            if (x1 > x0 && y1 > y0) o.put("face", floats(new float[] { x0 / f.W, y0 / f.H, (x1 - x0) / f.W, (y1 - y0) / f.H }));
        }
        notifyListeners("palm", o);
    }

    private static com.getcapacitor.JSArray floats(float[] v) {
        java.util.List<Double> a = new java.util.ArrayList<>();
        for (float x : v) a.add((double) x);
        return new com.getcapacitor.JSArray(a);
    }

    @PluginMethod public void setPalm(PluginCall call) {
        palm.setOn(Boolean.TRUE.equals(call.getBoolean("on", false)));
        try {
            com.getcapacitor.JSArray a = call.getArray("region");
            if (a != null && a.length() == 4) {
                float[] r = new float[4];
                for (int i = 0; i < 4; i++) r[i] = (float) Math.min(1, Math.max(0, a.getDouble(i)));
                if (r[2] > 0.02f && r[3] > 0.02f) palmRegion = r;
            } else palmRegion = new float[] { 0, 0, 1, 1 };
        } catch (Throwable ignored) { palmRegion = new float[] { 0, 0, 1, 1 }; }
        JSObject o = new JSObject(); o.put("ok", true); call.resolve(o);
    }

    /** Voice commands: listens while the camera is open (asks for the microphone the first time). */
    @PluginMethod public void setVoice(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        if (on && getPermissionState("microphone") != PermissionState.GRANTED) { requestPermissionForAlias("microphone", call, "micPermission"); return; }
        voiceOn(call, on);
    }

    @PermissionCallback private void micPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) voiceOn(call, true);
        else { JSObject o = new JSObject(); o.put("denied", true); call.resolve(o); }
    }

    private void voiceOn(PluginCall call, boolean on) {
        main.post(() -> {
            JSObject o = new JSObject();
            if (on && !VoiceListener.available(getContext())) { o.put("unavailable", true); call.resolve(o); return; }
            if (voice == null && on) voice = new VoiceListener(getContext(), new VoiceListener.Listener() {
                @Override public void onText(String text, int id) {
                    JSObject e = new JSObject(); e.put("text", text); e.put("id", id); notifyListeners("voice", e);
                }
                @Override public void onError(String error) {
                    JSObject e = new JSObject(); e.put("error", error); notifyListeners("voice", e);
                }
            });
            if (voice != null) voice.setOn(on);
            o.put("ok", true); call.resolve(o);
        });
    }

    @PluginMethod public void setKeys(PluginCall call) {
        String m = call.getString("mode", "shoot");
        keyMode = "zoom".equals(m) || "volume".equals(m) ? m : "shoot";
        call.resolve();
    }

    /** From MainActivity: true when the camera used the key (so the phone's volume stays as it is). */
    public static boolean onVolumeKey(int keyCode, boolean down, int repeat) {
        GlowCameraPlugin p = live;
        if (p == null || p.camera == null || "volume".equals(p.keyMode)) return false;
        if (keyCode != android.view.KeyEvent.KEYCODE_VOLUME_UP && keyCode != android.view.KeyEvent.KEYCODE_VOLUME_DOWN) return false;
        JSObject o = new JSObject();
        o.put("key", keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down");
        o.put("down", down);
        o.put("repeat", repeat);
        p.notifyListeners("key", o);
        return true;
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

    // ---------- Pro controls: zoom and lenses, focus, exposure, flash ----------

    /** Zoom range, the lenses as zoom numbers (1 = the main lens), exposure range, whether focus works, HDR. */
    private void putPro(JSObject o) {
        Camera c = camera;
        if (c == null) return;
        try {
            ZoomState z = c.getCameraInfo().getZoomState().getValue();
            float min = z != null ? z.getMinZoomRatio() : 1f, max = z != null ? z.getMaxZoomRatio() : 1f;
            o.put("zoomMin", min);
            o.put("zoomMax", max);
            JSArray l = new JSArray();
            for (float f : lensStops(c, min, max)) l.put(f);
            o.put("lenses", l);
        } catch (Throwable t) { Log.w(TAG, "zoom info", t); }
        try {
            ExposureState es = c.getCameraInfo().getExposureState();
            if (es.isExposureCompensationSupported()) {
                Rational st = es.getExposureCompensationStep();
                float step = st.floatValue();
                JSArray ev = new JSArray();
                ev.put(es.getExposureCompensationRange().getLower() * step);
                ev.put(es.getExposureCompensationRange().getUpper() * step);
                ev.put(step);
                o.put("ev", ev);
            }
        } catch (Throwable t) { Log.w(TAG, "exposure info", t); }
        o.put("focus", true);
        o.put("hdr", hdrAvailable);
        o.put("hdrOn", hdrOn);
    }

    /**
     * The phone's lenses as zoom numbers, from each physical camera's field of view against the
     * main one (for example 0.6, 1, 3, 5 on a Galaxy, 0.5, 1, 4 on an iPhone-like set). 2 is
     * always offered (a sharp crop of the main sensor, as the phones do). Phones that hide their
     * lenses get a sensible set for their zoom range.
     */
    @androidx.annotation.OptIn(markerClass = ExperimentalCamera2Interop.class)
    private List<Float> lensStops(Camera c, float min, float max) {
        List<Float> out = new ArrayList<>();
        out.add(1f);
        if (max >= 2f) out.add(2f);
        try {
            Camera2CameraInfo ci = Camera2CameraInfo.from(c.getCameraInfo());
            float main = fov(ci.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS),
                ci.getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE));
            if (main > 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                CameraManager cm = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
                Set<String> ids = cm.getCameraCharacteristics(ci.getCameraId()).getPhysicalCameraIds();
                for (String id : ids) {
                    CameraCharacteristics pc = cm.getCameraCharacteristics(id);
                    float f = fov(pc.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS), pc.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE));
                    if (f > 0) out.add(f / main);
                }
            }
        } catch (Throwable t) { Log.w(TAG, "lenses", t); }
        if (min < 0.95f) out.add(min);
        if (out.size() <= 3 && !mirror) { if (max >= 10f) out.add(5f); else if (max >= 4f) out.add(3f); }
        List<Float> clean = new ArrayList<>();
        for (float f : out) {
            float r = f < 1f ? Math.round(f * 10f) / 10f : Math.round(f * 2f) / 2f;
            if (r < min - 0.01f || r > max + 0.01f || r < 0.3f) continue;
            boolean dup = false;
            for (float g : clean) if (Math.abs(g - r) < 0.05f) dup = true;
            if (!dup) clean.add(r);
        }
        Collections.sort(clean);
        return clean;
    }

    /** A lens's zoom number up to a constant: its focal length over its sensor's diagonal. */
    private static float fov(float[] focal, SizeF sensor) {
        if (focal == null || focal.length == 0 || sensor == null) return 0;
        double d = Math.hypot(sensor.getWidth(), sensor.getHeight());
        return d > 0 ? (float) (focal[0] / d) : 0;
    }

    @PluginMethod public void setZoom(PluginCall call) {
        final float want = call.getFloat("zoom", 1f);
        main.post(() -> {
            Camera c = camera;
            if (c == null) { call.reject("The camera isn't ready"); return; }
            ZoomState z = c.getCameraInfo().getZoomState().getValue();
            float v = z == null ? want : Math.max(z.getMinZoomRatio(), Math.min(z.getMaxZoomRatio(), want));
            c.getCameraControl().setZoomRatio(v);
            JSObject o = new JSObject(); o.put("zoom", v); call.resolve(o);
        });
    }

    /**
     * Focus and exposure on a point of the upright picture (x, y from 0 to 1, not mirrored), like a
     * tap on a phone's camera. lock: keep them there (AE/AF lock) until the next tap or reset.
     */
    @androidx.annotation.OptIn(markerClass = ExperimentalCamera2Interop.class)
    @PluginMethod public void focus(PluginCall call) {
        final boolean reset = Boolean.TRUE.equals(call.getBoolean("reset", false));
        final boolean lock = Boolean.TRUE.equals(call.getBoolean("lock", false));
        final float x = Math.max(0f, Math.min(1f, call.getFloat("x", 0.5f))), y = Math.max(0f, Math.min(1f, call.getFloat("y", 0.5f)));
        main.post(() -> {
            Camera c = camera;
            if (c == null) { call.reject("The camera isn't ready"); return; }
            try {
                Camera2CameraControl.from(c.getCameraControl()).setCaptureRequestOptions(new CaptureRequestOptions.Builder()
                    .setCaptureRequestOption(CaptureRequest.CONTROL_AE_LOCK, lock && !reset).build());
            } catch (Throwable t) { Log.w(TAG, "ae lock", t); }
            if (reset) { c.getCameraControl().cancelFocusAndMetering(); call.resolve(); return; }
            // The frames come in the sensor's own orientation (frameRot turns them upright), so turn the point back.
            int rot;
            synchronized (frameLock) { rot = frameRot; }
            float bx = x, by = y;
            if (rot == 90) { bx = y; by = 1f - x; }
            else if (rot == 180) { bx = 1f - x; by = 1f - y; }
            else if (rot == 270) { bx = 1f - y; by = x; }
            MeteringPoint pt = new SurfaceOrientedMeteringPointFactory(1f, 1f).createPoint(bx, by);
            FocusMeteringAction.Builder b = new FocusMeteringAction.Builder(pt, FocusMeteringAction.FLAG_AF | FocusMeteringAction.FLAG_AE | FocusMeteringAction.FLAG_AWB);
            if (lock) b.disableAutoCancel(); else b.setAutoCancelDuration(5, TimeUnit.SECONDS);
            c.getCameraControl().startFocusAndMetering(b.build());
            call.resolve();
        });
    }

    /** Exposure compensation in stops (the camera rounds it to its own steps). */
    @PluginMethod public void setExposure(PluginCall call) {
        final float ev = call.getFloat("ev", 0f);
        main.post(() -> {
            Camera c = camera;
            if (c == null) { call.reject("The camera isn't ready"); return; }
            ExposureState es = c.getCameraInfo().getExposureState();
            if (!es.isExposureCompensationSupported()) { call.reject("No exposure control"); return; }
            float step = es.getExposureCompensationStep().floatValue();
            int i = Math.round(ev / step);
            i = Math.max(es.getExposureCompensationRange().getLower(), Math.min(es.getExposureCompensationRange().getUpper(), i));
            c.getCameraControl().setExposureCompensationIndex(i);
            JSObject o = new JSObject(); o.put("ev", i * step); call.resolve(o);
        });
    }

    /** The flash for photos: off, auto or on (the back camera's real flash). */
    @PluginMethod public void setFlash(PluginCall call) {
        String m = call.getString("mode", "auto");
        flashMode = "on".equals(m) ? ImageCapture.FLASH_MODE_ON : "off".equals(m) ? ImageCapture.FLASH_MODE_OFF : ImageCapture.FLASH_MODE_AUTO;
        main.post(() -> {
            ImageCapture ic = imageCapture;
            if (ic != null) ic.setFlashMode(flashMode);
            call.resolve();
        });
    }

    // ---------- Shutter ----------

    @PluginMethod public void capture(PluginCall call) {
        final Look lk = Look.from(call.getData());
        final boolean processed = Boolean.TRUE.equals(call.getBoolean("processed", true));
        final double aspect = call.getDouble("aspect", 0d);
        // The photo frame as fractions of the picture as shown (mirrored for selfies), if the page sent it.
        double[] cr = null;
        try {
            JSArray a = call.getArray("crop");
            if (a != null && a.length() == 4) {
                cr = new double[] { a.getDouble(0), a.getDouble(1), a.getDouble(2), a.getDouble(3) };
                if (!(cr[2] > 0.01 && cr[3] > 0.01)) cr = null;
            }
        } catch (Throwable t) { cr = null; }
        final double[] crop = cr;
        main.post(() -> {
            ImageCapture ic = imageCapture;
            if (ic == null || capturing) { call.reject("The camera isn't ready"); return; }
            capturing = true;
            final boolean mir = mirror;
            final int deg = devDeg, turn = faceTurn();
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
                    try { finish(call, jpeg, rot, mir, lk, processed, aspect, crop, deg, turn); }
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
    private void finish(PluginCall call, byte[] jpeg, int rot, boolean mir, Look lk, boolean processed, double aspect, double[] frame, int deg, int turn) throws Exception {
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
        if (frame != null) {
            // The frame the screen showed (photo shape, Adjust's face position), unmirrored for selfies.
            double fx = mir ? 1 - frame[0] - frame[2] : frame[0];
            cx = (int) Math.round(Math.max(0, fx) * W); cy = (int) Math.round(Math.max(0, frame[1]) * H);
            cw = (int) Math.round(frame[2] * W); ch = (int) Math.round(frame[3] * H);
            cw = Math.max(1, Math.min(W - cx, cw)); ch = Math.max(1, Math.min(H - cy, ch));
        }
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
            float[] P = tracker.detectStill(small, cw, ch, turn);
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
        res.put("deg", deg);   // how the phone was held; the page turns the photo to match
        call.resolve(res);
    }

    private static void save(Bitmap b, File f) throws Exception {
        try (FileOutputStream out = new FileOutputStream(f)) { b.compress(Bitmap.CompressFormat.JPEG, 92, out); }
    }
}
