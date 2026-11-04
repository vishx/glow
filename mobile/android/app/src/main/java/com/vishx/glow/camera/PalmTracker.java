package com.vishx.glow.camera;

import android.content.Context;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.util.Log;
import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.tasks.components.containers.Category;
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.core.Delegate;
import com.google.mediapipe.tasks.vision.core.RunningMode;
import com.google.mediapipe.tasks.vision.gesturerecognizer.GestureRecognizer;
import com.google.mediapipe.tasks.vision.gesturerecognizer.GestureRecognizerResult;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "Show palm" (like a Galaxy's Shooting methods): looks for an open hand facing the camera with
 * MediaPipe's gesture recognizer (the same model as the web camera's palmworker.js), about six
 * times a second on its own thread. The page decides when a palm has been held long enough and
 * takes the photo; this only reports what it sees.
 */
final class PalmTracker {
    private static final String TAG = "GlowCamera";
    /** Bundled with the web app by mobile/build-web.sh. */
    static final String MODEL = "public/vendor/gesture_recognizer.task";

    interface Listener { void onHand(float[] hand); }

    private final Context ctx;
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private GestureRecognizer rec;
    volatile boolean on, ready, failed;
    private volatile boolean busy, starting;
    private volatile long sentAt;
    private long lastTs;

    PalmTracker(Context ctx) { this.ctx = ctx.getApplicationContext(); }

    void setOn(boolean v) {
        on = v;
        if (!v || ready || failed || starting) return;
        starting = true;
        exec.execute(() -> {
            try {
                BaseOptions base = BaseOptions.builder().setModelAssetPath(MODEL).setDelegate(Delegate.CPU).build();
                GestureRecognizer.GestureRecognizerOptions o = GestureRecognizer.GestureRecognizerOptions.builder()
                    .setBaseOptions(base).setRunningMode(RunningMode.VIDEO).setNumHands(2)
                    .setMinHandDetectionConfidence(0.5f).setMinHandPresenceConfidence(0.5f).setMinTrackingConfidence(0.5f).build();
                rec = GestureRecognizer.createFromOptions(ctx, o);
                ready = true;
            } catch (Throwable t) { failed = true; Log.e(TAG, "palm model failed", t); }
            starting = false;
        });
    }

    /** About 6 looks a second (3 when the phone is warm). */
    boolean canSend(long now) {
        if (busy && now - sentAt > 4000) busy = false;
        return on && ready && !busy && now - sentAt >= (FaceTracker.hot ? 330 : 160);
    }

    /** Looks for an open palm in a small upright copy of the frame (recycled here). `turn` as in FaceTracker.
     *  Answers [score, x, y, w, h] (a box in the unturned frame, 0..1), or null for none. */
    void detect(Bitmap upright0, int turn, Listener l) {
        busy = true;
        sentAt = SystemClock.uptimeMillis();
        exec.execute(() -> {
            float[] hand = null;
            Bitmap upright = upright0;
            try {
                upright = FaceTracker.turned(upright0, turn, true);
                long ts = Math.max(lastTs + 1, SystemClock.uptimeMillis());
                lastTs = ts;
                hand = best(rec.recognizeForVideo(new BitmapImageBuilder(upright).build(), ts), turn);
            } catch (Throwable t) {
                Log.w(TAG, "palm detect", t);
            } finally {
                if (!upright.isRecycled()) upright.recycle();
            }
            busy = false;
            l.onHand(hand);
        });
    }

    /** The surest open palm, with its fingers pointing up (in the upright picture). */
    static float[] best(GestureRecognizerResult r, int turn) {
        if (r == null) return null;
        float[] out = null;
        for (int i = 0; i < r.gestures().size() && i < r.landmarks().size(); i++) {
            List<Category> g = r.gestures().get(i);
            if (g.isEmpty() || !"Open_Palm".equals(g.get(0).categoryName())) continue;
            float score = g.get(0).score();
            List<NormalizedLandmark> lm = r.landmarks().get(i);
            if (lm.size() < 21) continue;
            // Fingers up: the middle fingertip (12) above the wrist (0).
            if (lm.get(12).y() >= lm.get(0).y()) continue;
            float x0 = 1, y0 = 1, x1 = 0, y1 = 0;
            float[] pts = new float[lm.size() * 2];
            for (int k = 0; k < lm.size(); k++) { pts[k * 2] = lm.get(k).x(); pts[k * 2 + 1] = lm.get(k).y(); }
            pts = FaceTracker.unturn(pts, turn);
            for (int k = 0; k < pts.length; k += 2) {
                float x = pts[k], y = pts[k + 1];
                if (!Float.isFinite(x) || !Float.isFinite(y)) { x0 = 2; break; }
                x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
            }
            if (x0 > 1) continue;
            if (out == null || score > out[0]) out = new float[] { score, x0, y0, x1 - x0, y1 - y0 };
        }
        return out;
    }

    void close() {
        exec.execute(() -> { try { if (rec != null) rec.close(); } catch (Throwable ignored) {} rec = null; ready = false; });
    }
}
