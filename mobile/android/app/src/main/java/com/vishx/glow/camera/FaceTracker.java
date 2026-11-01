package com.vishx.glow.camera;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Matrix;
import android.os.SystemClock;
import android.util.Log;
import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.core.Delegate;
import com.google.mediapipe.tasks.vision.core.RunningMode;
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker;
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Follows the face in the camera frames with MediaPipe's face landmarker (the same model and the
 * same 478 points as the web camera's faceworker.js), on its own thread so the preview never waits.
 * Runs on the CPU: some Android GPUs returned NaN points through the GPU delegate.
 */
final class FaceTracker {
    private static final String TAG = "GlowCamera";
    /** Bundled with the web app by mobile/build-web.sh; Capacitor puts www/ under assets/public/. */
    static final String MODEL = "public/vendor/face_landmarker.task";

    interface Listener { void onChange(); }

    private final Context ctx;
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private FaceLandmarker video, still;
    volatile boolean started, ready, failed;
    /** The phone is warm (thermal status moderate or worse): track less often. */
    static volatile boolean hot;
    volatile String error = "";
    private volatile boolean busy;
    private volatile long sentAt;
    private long lastTs;

    private final Object lock = new Object();
    private float[] pts;      // eased points in frame pixels, or null
    private int W, H;         // the frame size the points belong to
    private float seen;       // 0..1: how sure we are a face is in view

    FaceTracker(Context ctx) { this.ctx = ctx.getApplicationContext(); }

    private FaceLandmarker make(RunningMode mode) {
        BaseOptions base = BaseOptions.builder().setModelAssetPath(MODEL).setDelegate(Delegate.CPU).build();
        FaceLandmarker.FaceLandmarkerOptions opts = FaceLandmarker.FaceLandmarkerOptions.builder()
            .setBaseOptions(base).setRunningMode(mode).setNumFaces(1).build();
        return FaceLandmarker.createFromOptions(ctx, opts);
    }

    void init(Listener l) {
        if (started) return;
        started = true;
        exec.execute(() -> {
            try { video = make(RunningMode.VIDEO); ready = true; failed = false; }
            catch (Throwable t) { failed = true; error = String.valueOf(t.getMessage()); Log.e(TAG, "face model failed", t); }
            l.onChange();
        });
    }

    /** Frames with no face in view are checked about 5 times a second, to save battery. */
    boolean canSend(long now) {
        if (busy && now - sentAt > 4000) busy = false;   // an answer that never came must not stop tracking
        float s;
        synchronized (lock) { s = seen; }
        return ready && !busy && now - sentAt >= (s > 0 ? (hot ? 90 : 30) : (hot ? 400 : 200));
    }

    /** Normalised points found in a copy turned `turn` degrees clockwise, back in the unturned picture. */
    static float[] unturn(float[] n, int turn) {
        if (n == null || turn == 0) return n;
        float[] o = new float[n.length];
        for (int i = 0; i < n.length; i += 2) {
            float x = n[i], y = n[i + 1];
            if (turn == 90) { o[i] = y; o[i + 1] = 1 - x; }
            else if (turn == 180) { o[i] = 1 - x; o[i + 1] = 1 - y; }
            else { o[i] = 1 - y; o[i + 1] = x; }   // 270
        }
        return o;
    }
    /** The bitmap turned `turn` degrees clockwise (the same one when 0); recycles the input when it makes a new one. */
    static Bitmap turned(Bitmap b, int turn, boolean recycle) {
        if (turn == 0) return b;
        Matrix m = new Matrix();
        m.postRotate(turn);
        Bitmap t = Bitmap.createBitmap(b, 0, 0, b.getWidth(), b.getHeight(), m, true);
        if (recycle && t != b) b.recycle();
        return t;
    }

    /** Finds the face in a small upright copy of a W×H frame; the bitmap is recycled here.
     *  turn: degrees clockwise the picture is turned first, so a face in a sideways-held phone is upright for the model. */
    void detect(Bitmap upright0, int frameW, int frameH, int turn, Listener l) {
        busy = true;
        sentAt = SystemClock.uptimeMillis();
        exec.execute(() -> {
            float[] norm = null;
            Bitmap upright = upright0;
            try {
                upright = turned(upright0, turn, true);
                long ts = Math.max(lastTs + 1, SystemClock.uptimeMillis());
                lastTs = ts;
                FaceLandmarkerResult r = video.detectForVideo(new BitmapImageBuilder(upright).build(), ts);
                norm = unturn(first(r), turn);
            } catch (Throwable t) {
                Log.w(TAG, "face detect", t);
            } finally {
                if (!upright.isRecycled()) upright.recycle();
            }
            take(norm, frameW, frameH);
            busy = false;
            l.onChange();
        });
    }

    private static float[] first(FaceLandmarkerResult r) {
        if (r == null || r.faceLandmarks().isEmpty()) return null;
        List<NormalizedLandmark> f = r.faceLandmarks().get(0);
        float[] out = new float[f.size() * 2];
        for (int i = 0; i < f.size(); i++) {
            float x = f.get(i).x(), y = f.get(i).y();
            if (!Float.isFinite(x) || !Float.isFinite(y)) return null;   // seen on some phones
            out[i * 2] = x; out[i * 2 + 1] = y;
        }
        return out.length >= 478 * 2 ? out : null;
    }

    /** Eases the points toward the new ones, so makeup doesn't shimmer when the face is still. */
    private void take(float[] norm, int fw, int fh) {
        synchronized (lock) {
            if (norm == null) { seen = Math.max(0, seen - 0.34f); return; }   // the points stay while the look fades out
            float[] raw = new float[norm.length];
            for (int i = 0; i < norm.length; i += 2) { raw[i] = norm[i] * fw; raw[i + 1] = norm[i + 1] * fh; }
            if (pts == null || seen == 0 || pts.length != raw.length || W != fw || H != fh) pts = raw;
            else {
                float faceW = Math.max(1, FaceGeometry.dist(raw, FaceGeometry.CHEEK_L, FaceGeometry.CHEEK_R));
                float move = 0;
                for (int i : new int[] { 1, 33, 263, 61, 291, 152 }) move += Math.hypot(raw[i * 2] - pts[i * 2], raw[i * 2 + 1] - pts[i * 2 + 1]);
                move = move / 6 / faceW;
                float k = Math.min(1, 0.4f + move * 12);
                float[] eased = new float[raw.length];
                for (int i = 0; i < raw.length; i++) eased[i] = pts[i] + (raw[i] - pts[i]) * k;
                pts = eased;
            }
            W = fw; H = fh;
            seen = Math.min(1, seen + 0.5f);
        }
    }

    void reset() { synchronized (lock) { pts = null; seen = 0; } }

    /** A snapshot for drawing: points (shared, never changed in place), frame size, and seen. */
    static final class Snap { float[] pts; int W, H; float seen; }

    Snap snap() {
        Snap s = new Snap();
        synchronized (lock) { s.pts = pts; s.W = W; s.H = H; s.seen = seen; }
        return s;
    }

    void forgetIfGone() { synchronized (lock) { if (seen == 0) pts = null; } }

    /** Finds the face in a still photo (a small copy is enough: the points come back as fractions). */
    float[] detectStill(Bitmap small0, int W, int H, int turn) {
        try {
            synchronized (this) {
                if (still == null) still = make(RunningMode.IMAGE);
                Bitmap small = turned(small0, turn, false);
                float[] n = unturn(first(still.detect(new BitmapImageBuilder(small).build())), turn);
                if (small != small0) small.recycle();
                if (n == null) return null;
                for (int i = 0; i < n.length; i += 2) { n[i] *= W; n[i + 1] *= H; }
                return n;
            }
        } catch (Throwable t) {
            Log.w(TAG, "still face detect", t);
            return null;
        }
    }
}
