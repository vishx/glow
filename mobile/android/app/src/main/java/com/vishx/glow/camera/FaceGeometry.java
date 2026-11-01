package com.vishx.glow.camera;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;

/**
 * The face masks and reshape moves for the beauty shader: a line-for-line port of drawMasks()
 * and setShape() in public/livebeauty.js, so the native camera draws the same look as the web one.
 * Points are MediaPipe's 478-point face mesh, as x, y pairs in frame pixels.
 */
final class FaceGeometry {
    static final int BROW = 10, CHEEK_L = 234, CHEEK_R = 454, CHIN = 152, NOSE_TIP = 4, NOSE_BASE = 2,
        ALAR_L = 129, ALAR_R = 358, JAW_L = 172, JAW_R = 397, LOW_JAW_L = 136, LOW_JAW_R = 365, APPLE_L = 50, APPLE_R = 280;
    static final int[] OVAL = { 10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109 };
    static final int[] EYE_L = { 33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246 };
    static final int[] EYE_R = { 362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398 };
    static final int[] BROW_L = { 70, 63, 105, 66, 107, 55, 65, 52, 53, 46 };
    static final int[] BROW_R = { 300, 293, 334, 296, 336, 285, 295, 282, 283, 276 };
    static final int[] LIPS_OUT = { 61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185 };
    static final int[] LIPS_IN = { 78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191 };

    /** Coarse mask: skin (red), blush (blue). Fine mask: brows (red), lips (green). */
    Bitmap maskA, maskB;
    final Bitmap blank = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG), line = new Paint(Paint.ANTI_ALIAS_FLAG), glow = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final PorterDuffXfermode add = new PorterDuffXfermode(PorterDuff.Mode.ADD);

    // Reshape uniforms (see setShape in livebeauty.js).
    final float[] eyeL = { 0, 0, 1, 0 }, eyeR = { 0, 0, 1, 0 }, slim = new float[16], nose = new float[8], slimR = { 1, 1 };

    FaceGeometry() {
        blank.eraseColor(Color.BLACK);
        fill.setStyle(Paint.Style.FILL);
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeJoin(Paint.Join.ROUND);
        line.setColor(Color.BLACK);
        glow.setXfermode(add);
    }

    static float dist(float[] P, int a, int b) {
        return (float) Math.hypot(P[a * 2] - P[b * 2], P[a * 2 + 1] - P[b * 2 + 1]);
    }

    private static float[] mean(float[] P, int[] idx, float s) {
        float x = 0, y = 0;
        for (int i : idx) { x += P[i * 2]; y += P[i * 2 + 1]; }
        return new float[] { x / idx.length * s, y / idx.length * s };
    }

    private static Path poly(float[] P, int[] idx, float s) {
        Path p = new Path();
        for (int k = 0; k < idx.length; k++) {
            float x = P[idx[k] * 2] * s, y = P[idx[k] * 2 + 1] * s;
            if (k == 0) p.moveTo(x, y); else p.lineTo(x, y);
        }
        p.close();
        return p;
    }

    private static Bitmap sized(Bitmap bm, int w, int h) {
        if (bm != null && bm.getWidth() == w && bm.getHeight() == h) return bm;
        if (bm != null) bm.recycle();
        return Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
    }

    void drawMasks(int W, int H, float[] P) {
        float s = Math.min(1f, 96f / Math.max(W, H));
        maskA = sized(maskA, Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s)));
        Canvas a = new Canvas(maskA);
        a.drawColor(Color.BLACK, PorterDuff.Mode.SRC);
        float faceW = dist(P, CHEEK_L, CHEEK_R) * s;
        float[] faceC = mean(P, OVAL, s);
        fill.setXfermode(null);
        // Skin: the face without eyes, brows, lips and nostrils.
        fill.setColor(Color.RED);
        a.drawPath(poly(P, OVAL, s), fill);
        fill.setColor(Color.BLACK);
        for (int[] e : new int[][] { EYE_L, EYE_R }) {
            float[] c = mean(P, e, s);
            float ew = dist(P, e[0], e[8]) * s;
            double ang = Math.atan2(P[e[8] * 2 + 1] - P[e[0] * 2 + 1], P[e[8] * 2] - P[e[0] * 2]);
            a.save();
            a.rotate((float) Math.toDegrees(ang), c[0], c[1]);
            a.drawOval(new RectF(c[0] - ew * 0.75f, c[1] - ew * 0.45f, c[0] + ew * 0.75f, c[1] + ew * 0.45f), fill);
            a.restore();
        }
        line.setStrokeWidth(faceW / 22f);
        for (int[] br : new int[][] { BROW_L, BROW_R }) {
            Path p = poly(P, br, s);
            a.drawPath(p, fill);
            a.drawPath(p, line);
        }
        a.drawPath(poly(P, LIPS_OUT, s), fill);
        float nbx = P[NOSE_BASE * 2] * s, nby = P[NOSE_BASE * 2 + 1] * s - faceW * 0.02f;
        a.drawOval(new RectF(nbx - faceW * 0.09f, nby - faceW * 0.05f, nbx + faceW * 0.09f, nby + faceW * 0.05f), fill);
        // Blush: a soft round wash on the apple of each cheek.
        for (int i : new int[] { APPLE_L, APPLE_R }) {
            float cx = (P[i * 2] * s * 2 + faceC[0]) / 3f, cy = P[i * 2 + 1] * s - faceW * 0.02f, r = faceW * 0.2f;
            if (!(r > 0.5f)) continue;
            glow.setShader(new RadialGradient(cx, cy, r,
                new int[] { Color.argb(230, 0, 0, 255), Color.argb(128, 0, 0, 255), Color.argb(0, 0, 0, 255) },
                new float[] { 0f, 0.5f, 1f }, Shader.TileMode.CLAMP));
            a.drawRect(cx - r, cy - r, cx + r, cy + r, glow);
        }

        s = Math.min(1f, 320f / Math.max(W, H));
        maskB = sized(maskB, Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s)));
        Canvas b = new Canvas(maskB);
        b.drawColor(Color.BLACK, PorterDuff.Mode.SRC);
        fill.setColor(Color.RED);
        for (int[] br : new int[][] { BROW_L, BROW_R }) b.drawPath(poly(P, br, s), fill);
        // Lips: the outer lip line minus the open mouth.
        fill.setXfermode(add);
        fill.setColor(Color.GREEN);
        b.drawPath(poly(P, LIPS_OUT, s), fill);
        fill.setXfermode(null);
        fill.setColor(Color.BLACK);
        b.drawPath(poly(P, LIPS_IN, s), fill);
    }

    /** The reshape moves, kept as gentle as the still-photo tools. Amounts are 0..1 (already faded). */
    void shape(float[] P, float eyes, float slimAmt, float noseAmt) {
        float faceW = dist(P, CHEEK_L, CHEEK_R);
        int[][] eyesIdx = { EYE_L, EYE_R };
        float[][] eyeOut = { eyeL, eyeR };
        for (int k = 0; k < 2; k++) {
            float[] c = mean(P, eyesIdx[k], 1f);
            float ew = dist(P, eyesIdx[k][0], eyesIdx[k][8]);
            eyeOut[k][0] = c[0]; eyeOut[k][1] = c[1]; eyeOut[k][2] = ew * 1.25f; eyeOut[k][3] = eyes * 0.2f;
        }
        // Slim: the lower cheeks and jaw move straight in toward the line down the middle of the face.
        float tx = P[BROW * 2], ty = P[BROW * 2 + 1], cx = P[CHIN * 2], cy = P[CHIN * 2 + 1];
        float al = (float) Math.hypot(cx - tx, cy - ty);
        if (al == 0) al = 1;
        float ax = (cx - tx) / al, ay = (cy - ty) / al;
        int[] jaw = { JAW_L, JAW_R, LOW_JAW_L, LOW_JAW_R };
        for (int k = 0; k < 4; k++) {
            float px = P[jaw[k] * 2], py = P[jaw[k] * 2 + 1];
            float t = (px - tx) * ax + (py - ty) * ay;
            float dx = tx + ax * t - px, dy = ty + ay * t - py;
            float l = (float) Math.hypot(dx, dy);
            if (l == 0) l = 1;
            float m = faceW * 0.05f * slimAmt;
            slim[k * 4] = px; slim[k * 4 + 1] = py; slim[k * 4 + 2] = dx / l * m; slim[k * 4 + 3] = dy / l * m;
        }
        // Nose: the sides of the nose move in toward its tip.
        float nx = P[NOSE_TIP * 2], ny = P[NOSE_TIP * 2 + 1], noseW = dist(P, ALAR_L, ALAR_R);
        int[] alar = { ALAR_L, ALAR_R };
        for (int k = 0; k < 2; k++) {
            float px = P[alar[k] * 2], py = P[alar[k] * 2 + 1];
            float dx = nx - px, dy = ny - py, l = (float) Math.hypot(dx, dy);
            if (l == 0) l = 1;
            float m = noseW * 0.12f * noseAmt;
            nose[k * 4] = px; nose[k * 4 + 1] = py; nose[k * 4 + 2] = dx / l * m; nose[k * 4 + 3] = dy / l * m;
        }
        slimR[0] = faceW * 0.36f; slimR[1] = noseW * 0.8f;
    }

    void clearShape() {
        eyeL[0] = eyeL[1] = 0; eyeL[2] = 1; eyeL[3] = 0;
        eyeR[0] = eyeR[1] = 0; eyeR[2] = 1; eyeR[3] = 0;
        java.util.Arrays.fill(slim, 0);
        java.util.Arrays.fill(nose, 0);
        slimR[0] = slimR[1] = 1;
    }
}
