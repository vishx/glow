package com.vishx.glow.camera;

import android.graphics.Bitmap;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.opengl.GLUtils;
import android.util.Log;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.HashMap;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * Draws the camera with the live look: the same shader as public/livebeauty.js (face reshape,
 * skin smoothing on the face only, lips, blush and brows, brightness and warmth), plus the photo
 * filter as a color matrix. Everything is worked out in "frame" pixels: the camera picture turned
 * upright and not mirrored. The front camera is mirrored only when drawn, so photo and preview match.
 */
final class BeautyRenderer implements GLSurfaceView.Renderer {
    private static final String TAG = "GlowCamera";

    private static final String VERT =
        "attribute vec2 p; varying vec2 uv;\n" +
        "uniform vec4 crop; uniform float mirror, flipY;\n" +
        "void main() {\n" +
        "  vec2 s = vec2(p.x * 0.5 + 0.5, flipY > 0.5 ? p.y * 0.5 + 0.5 : 0.5 - p.y * 0.5);\n" +
        "  if (mirror > 0.5) s.x = 1.0 - s.x;\n" +
        "  uv = crop.xy + s * crop.zw;\n" +
        "  gl_Position = vec4(p, 0.0, 1.0);\n" +
        "}\n";

    private static final String FRAG = """
        #ifdef GL_FRAGMENT_PRECISION_HIGH
        precision highp float;
        #else
        precision mediump float;
        #endif
        varying vec2 uv;
        uniform sampler2D tex, mA, mB;
        uniform vec4 rot; uniform vec2 rotOff; uniform float bufScale;   // frame uv -> camera buffer uv
        uniform vec2 size, mpxA, mpxB;
        uniform float smooth_, bright, warm, faceOn, plain, tapScale;
        uniform vec4 eyeL, eyeR;
        uniform vec4 slim[4];
        uniform vec4 nose[2];
        uniform vec2 slimR;
        uniform vec4 lips, blush, brows;
        uniform vec4 cr, cg, cb, wash;                                   // filter: color matrix rows, soft-light wash

        vec3 cam(vec2 q) {
          vec2 b = vec2(rot.x * q.x + rot.y * q.y, rot.z * q.x + rot.w * q.y) + rotOff;
          return texture2D(tex, vec2(b.x * bufScale, b.y)).rgb;
        }
        vec2 shift(vec2 p, vec4 cm, float r) {
          vec2 d = p - cm.xy; float t = dot(d, d) / (r * r);
          if (t >= 1.0) return p;
          float f = 1.0 - t;
          return p - f * f * cm.zw;
        }
        vec2 zoom(vec2 p, vec4 e) {
          vec2 d = p - e.xy; float t = length(d) / e.z;
          if (t >= 1.0 || e.w <= 0.0) return p;
          float f = 1.0 - t * t;
          return e.xy + d * (1.0 - e.w * f * f);
        }
        vec4 soft(sampler2D m, vec2 q, vec2 mpx) {
          vec4 s = vec4(0.0);
          for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) s += texture2D(m, q + vec2(float(x), float(y)) * mpx * 1.3);
          return s / 9.0;
        }
        float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
        vec3 softLight(vec3 a, vec3 b) {
          return mix(2.0 * a * b + a * a * (1.0 - 2.0 * b), sqrt(a) * (2.0 * b - 1.0) + 2.0 * a * (1.0 - b), step(0.5, b));
        }

        void main() {
          if (plain > 0.5) { gl_FragColor = vec4(cam(uv), 1.0); return; }
          vec2 p = uv * size;
          if (faceOn > 0.5) {
            for (int i = 0; i < 4; i++) p = shift(p, slim[i], slimR.x);
            for (int i = 0; i < 2; i++) p = shift(p, nose[i], slimR.y);
            p = zoom(zoom(p, eyeL), eyeR);
          }
          vec2 q = p / size, px = tapScale / size;
          vec3 c = cam(q), sum = c; float wsum = 1.0;
          for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) {
            if (x == 0 && y == 0) continue;
            vec3 s = cam(q + vec2(float(x), float(y)) * px * 2.0);
            float d = distance(s, c);
            float w = exp(-d * d * 60.0) * exp(-float(x * x + y * y) / 18.0);
            sum += s * w; wsum += w;
          }
          vec4 a = faceOn > 0.5 ? soft(mA, q, mpxA) : vec4(1.0, 0.0, 0.0, 0.0);
          vec3 col = mix(c, sum / wsum, smooth_ * a.r);
          if (faceOn > 0.5) {
            vec4 b = soft(mB, q, mpxB);
            float bm = b.r * brows.a;
            col = mix(col, mix(col * brows.rgb * 1.25, brows.rgb, 0.25), bm);
            float cm = a.b * blush.a;
            col = mix(col, softLight(col, blush.rgb), cm);
            col = mix(col, col * blush.rgb, cm * 0.25);
            float lm = b.g * lips.a;
            vec3 tint = lips.rgb * ((lum(col) * 0.45 + lum(lips.rgb) * 0.55) / max(lum(lips.rgb), 0.05));
            col = mix(col, clamp(tint, 0.0, 1.0), lm);
          }
          col = pow(max(col, 0.0), vec3(1.0 - bright * 0.35));
          col += vec3(0.06, 0.025, -0.03) * warm;
          col = clamp(col, 0.0, 1.0);
          col = clamp(vec3(dot(cr.xyz, col) + cr.w, dot(cg.xyz, col) + cg.w, dot(cb.xyz, col) + cb.w), 0.0, 1.0);
          col = mix(col, softLight(col, wash.rgb), wash.a);
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }
        """;

    private final GlowCameraPlugin host;
    private final FaceTracker tracker;
    private final FaceGeometry geo = new FaceGeometry();
    private int prog, texCam, texA, texB, texStill;
    private int camTexW = -1, camTexH = -1;
    private final HashMap<String, Integer> u = new HashMap<>();
    private FloatBuffer quad;
    private int surfW = 1, surfH = 1;
    int maxTex = 4096;
    private float shown;   // face effects fade in and out
    private boolean ok;

    BeautyRenderer(GlowCameraPlugin host, FaceTracker tracker) { this.host = host; this.tracker = tracker; }

    private static int shader(int type, String src) {
        int s = GLES20.glCreateShader(type);
        GLES20.glShaderSource(s, src);
        GLES20.glCompileShader(s);
        int[] okv = new int[1];
        GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, okv, 0);
        if (okv[0] == 0) { Log.e(TAG, "shader: " + GLES20.glGetShaderInfoLog(s)); return 0; }
        return s;
    }

    private static int texture() {
        int[] t = new int[1];
        GLES20.glGenTextures(1, t, 0);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t[0]);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        return t[0];
    }

    @Override public void onSurfaceCreated(GL10 unused, EGLConfig config) {
        camTexW = camTexH = -1;
        int vs = shader(GLES20.GL_VERTEX_SHADER, VERT), fs = shader(GLES20.GL_FRAGMENT_SHADER, FRAG);
        ok = vs != 0 && fs != 0;
        if (!ok) { host.rendererFailed("shader"); return; }
        prog = GLES20.glCreateProgram();
        GLES20.glAttachShader(prog, vs);
        GLES20.glAttachShader(prog, fs);
        GLES20.glLinkProgram(prog);
        int[] linked = new int[1];
        GLES20.glGetProgramiv(prog, GLES20.GL_LINK_STATUS, linked, 0);
        if (linked[0] == 0) { ok = false; Log.e(TAG, "link: " + GLES20.glGetProgramInfoLog(prog)); host.rendererFailed("link"); return; }
        GLES20.glUseProgram(prog);
        quad = ByteBuffer.allocateDirect(8 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        quad.put(new float[] { -1, -1, 1, -1, -1, 1, 1, 1 }).position(0);
        int loc = GLES20.glGetAttribLocation(prog, "p");
        GLES20.glEnableVertexAttribArray(loc);
        GLES20.glVertexAttribPointer(loc, 2, GLES20.GL_FLOAT, false, 0, quad);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE1); texA = texture();
        GLES20.glActiveTexture(GLES20.GL_TEXTURE2); texB = texture();
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0); texCam = texture(); texStill = texture();
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texCam);
        for (String n : new String[] { "crop", "mirror", "flipY", "rot", "rotOff", "bufScale", "size", "mpxA", "mpxB", "smooth_", "bright", "warm",
            "faceOn", "plain", "tapScale", "eyeL", "eyeR", "slim", "nose", "slimR", "lips", "blush", "brows", "cr", "cg", "cb", "wash" })
            u.put(n, GLES20.glGetUniformLocation(prog, n));
        GLES20.glUniform1i(GLES20.glGetUniformLocation(prog, "tex"), 0);
        GLES20.glUniform1i(GLES20.glGetUniformLocation(prog, "mA"), 1);
        GLES20.glUniform1i(GLES20.glGetUniformLocation(prog, "mB"), 2);
        int[] mt = new int[1];
        GLES20.glGetIntegerv(GLES20.GL_MAX_TEXTURE_SIZE, mt, 0);
        int[] mr = new int[1];
        GLES20.glGetIntegerv(GLES20.GL_MAX_RENDERBUFFER_SIZE, mr, 0);
        maxTex = Math.max(2048, Math.min(mt[0], mr[0] > 0 ? mr[0] : mt[0]));
    }

    @Override public void onSurfaceChanged(GL10 unused, int w, int h) { surfW = Math.max(1, w); surfH = Math.max(1, h); }

    @Override public void onDrawFrame(GL10 unused) {
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
        GLES20.glViewport(0, 0, surfW, surfH);
        GLES20.glClearColor(0, 0, 0, 1);
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
        if (!ok) return;
        int bufW, bufH, texW, rot;
        synchronized (host.frameLock) {
            if (!host.hasFrame) return;
            bufW = host.bufW; bufH = host.bufH; texW = host.texW; rot = host.frameRot;
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texCam);
            if (host.frameNew) {
                ByteBuffer b = host.frameBuf.duplicate();
                b.position(0);
                if (camTexW != texW || camTexH != bufH) {
                    GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, texW, bufH, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, b);
                    camTexW = texW; camTexH = bufH;
                } else {
                    GLES20.glTexSubImage2D(GLES20.GL_TEXTURE_2D, 0, 0, 0, texW, bufH, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, b);
                }
                host.frameNew = false;
            }
        }
        boolean side = rot % 180 != 0;
        int W = side ? bufH : bufW, H = side ? bufW : bufH;
        Look look = host.look;
        // The preview fills the viewfinder's box (cropped, not shrunk), like the web camera's object-fit: cover.
        int vx = Math.round(look.view[0] * surfW), vy = Math.round(look.view[1] * surfH);
        int vw = Math.max(1, Math.round(look.view[2] * surfW)), vh = Math.max(1, Math.round(look.view[3] * surfH));
        GLES20.glViewport(vx, surfH - (vy + vh), vw, vh);
        float k = Math.max((float) vw / W, (float) vh / H);
        float cw = Math.min(1f, vw / k / W), ch = Math.min(1f, vh / k / H);
        float[] crop = { (1 - cw) / 2, (1 - ch) * look.posY, cw, ch };

        FaceTracker.Snap s = tracker.snap();
        boolean want = s.pts != null && s.seen > 0 && tracker.ready && s.W == W && s.H == H;
        shown += ((want ? 1 : 0) - shown) * 0.3f;
        if (Math.abs((want ? 1 : 0) - shown) < 0.02f) shown = want ? 1 : 0;
        if (!want && shown == 0) tracker.forgetIfGone();
        float[] P = s.pts != null && s.W == W && s.H == H && shown > 0 ? s.pts : null;
        draw(W, H, rotation(rot), (float) bufW / texW, crop, host.mirror, false, Math.max(W, H) / 1280f, look, look.compare,
            !tracker.failed, P, P != null ? shown : 0);
    }

    /** a, b, c, d, offset x, offset y: frame uv -> camera buffer uv for a buffer that needs `rot` degrees clockwise to stand upright. */
    private static float[] rotation(int rot) {
        switch ((rot % 360 + 360) % 360) {
            case 90: return new float[] { 0, 1, -1, 0, 0, 1 };
            case 180: return new float[] { -1, 0, 0, -1, 1, 1 };
            case 270: return new float[] { 0, -1, 1, 0, 1, 0 };
            default: return new float[] { 1, 0, 0, 1, 0, 0 };
        }
    }

    private void uniform(String n, float... v) {
        Integer loc = u.get(n);
        if (loc == null || loc < 0) return;
        switch (v.length) {
            case 1: GLES20.glUniform1f(loc, v[0]); break;
            case 2: GLES20.glUniform2f(loc, v[0], v[1]); break;
            case 4: GLES20.glUniform4f(loc, v[0], v[1], v[2], v[3]); break;
            default: GLES20.glUniform4fv(loc, v.length / 4, v, 0);
        }
    }

    private void shade(String key, float[] rgb, float amt, float base, float span) {
        uniform(key, rgb[0], rgb[1], rgb[2], amt > 0 ? base + span * amt : 0);
    }

    private void draw(int W, int H, float[] r, float bufScale, float[] crop, boolean mirror, boolean flipY, float tapScale,
                      Look look, boolean plain, boolean faceOn, float[] P, float k) {
        GLES20.glUseProgram(prog);
        uniform("crop", crop);
        uniform("mirror", mirror ? 1 : 0);
        uniform("flipY", flipY ? 1 : 0);
        uniform("rot", r[0], r[1], r[2], r[3]);
        uniform("rotOff", r[4], r[5]);
        uniform("bufScale", bufScale);
        uniform("size", W, H);
        uniform("tapScale", Math.max(1f, tapScale));
        uniform("plain", plain ? 1 : 0);
        uniform("smooth_", look.smooth);
        uniform("bright", look.bright);
        uniform("warm", look.warm);
        uniform("faceOn", faceOn ? 1 : 0);
        float[] c = look.color;
        uniform("cr", c[0], c[1], c[2], c[3]);
        uniform("cg", c[4], c[5], c[6], c[7]);
        uniform("cb", c[8], c[9], c[10], c[11]);
        uniform("wash", look.wash[0], look.wash[1], look.wash[2], look.wash[3]);
        Bitmap a = geo.blank, b = geo.blank;
        if (faceOn && P != null) {
            geo.drawMasks(W, H, P);
            a = geo.maskA; b = geo.maskB;
            geo.shape(P, look.eyes * k, look.slim * k, look.nose * k);
        } else geo.clearShape();
        uniform("mpxA", 1f / a.getWidth(), 1f / a.getHeight());
        uniform("mpxB", 1f / b.getWidth(), 1f / b.getHeight());
        GLES20.glActiveTexture(GLES20.GL_TEXTURE1);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texA);
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, a, 0);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE2);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texB);
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, b, 0);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        float kk = P != null ? k : 0;
        shade("lips", look.lipShade, look.lips * kk, 0.15f, 0.45f);
        shade("blush", look.blushShade, look.blush * kk, 0.1f, 0.35f);
        shade("brows", look.browShade, look.brows * kk, 0.1f, 0.4f);
        uniform("eyeL", geo.eyeL);
        uniform("eyeR", geo.eyeR);
        uniform("slim", geo.slim);
        uniform("nose", geo.nose);
        uniform("slimR", geo.slimR);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
    }

    /**
     * Draws a still photo (upright, not mirrored) with the look at full size, offscreen, and
     * returns the result (mirrored for the front camera). Runs on the GL thread.
     */
    Bitmap renderStill(Bitmap src, float[] P, Look look, boolean mirror) {
        if (!ok) return null;
        int W = src.getWidth(), H = src.getHeight();
        int[] fb = new int[1], out = new int[1];
        GLES20.glGenFramebuffers(1, fb, 0);
        GLES20.glGenTextures(1, out, 0);
        try {
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, out[0]);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_NEAREST);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_NEAREST);
            GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, W, H, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null);
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fb[0]);
            GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, out[0], 0);
            if (GLES20.glCheckFramebufferStatus(GLES20.GL_FRAMEBUFFER) != GLES20.GL_FRAMEBUFFER_COMPLETE) { Log.e(TAG, "framebuffer incomplete"); return null; }
            GLES20.glViewport(0, 0, W, H);
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texStill);
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, src, 0);
            Look still = look;
            if (still.compare) { still = Look.copyOf(look); still.compare = false; }
            draw(W, H, rotation(0), 1f, new float[] { 0, 0, 1, 1 }, mirror, true, Math.max(W, H) / 1280f, still, false,
                !tracker.failed, P, P != null ? 1 : 0);
            ByteBuffer px = ByteBuffer.allocateDirect(W * H * 4).order(ByteOrder.nativeOrder());
            GLES20.glReadPixels(0, 0, W, H, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, px);
            px.position(0);
            Bitmap bm = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
            bm.copyPixelsFromBuffer(px);
            return bm;
        } catch (Throwable t) {
            Log.e(TAG, "renderStill", t);
            return null;
        } finally {
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
            GLES20.glDeleteFramebuffers(1, fb, 0);
            GLES20.glDeleteTextures(1, out, 0);
            // The still replaced the small texture's contents; the camera texture is untouched.
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texCam);
            GLES20.glViewport(0, 0, surfW, surfH);
        }
    }
}
