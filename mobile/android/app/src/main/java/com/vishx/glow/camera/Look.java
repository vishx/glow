package com.vishx.glow.camera;

import android.graphics.Color;
import org.json.JSONArray;
import org.json.JSONObject;

/** The look the camera draws, as sent by the web app (public/app.js nativeLook()). Immutable. */
final class Look {
    // 0..1
    float smooth, bright, warm, eyes, slim, nose, lips, blush, brows;
    float[] lipShade = rgb("#d4787d"), blushShade = rgb("#f4a28c"), browShade = rgb("#5a4030");
    /** The photo filter as four color matrices applied in turn, each three rows of r, g, b, offset
     *  (the CSS filter chain, built in JS); the result is kept in 0..1 after each, as CSS does. */
    float[] color = { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0 };
    /** The filter's soft-light color wash: r, g, b, alpha (0..1). */
    float[] wash = { 0, 0, 0, 0 };
    /** Hold-to-compare: the camera without the look. */
    boolean compare;
    /** Where the preview's crop sits vertically (0 top .. 1 bottom), as the web camera's object-position. */
    float posY = 0.5f;
    /** The viewfinder's box in the window: x, y, width, height as fractions. */
    float[] view = { 0, 0, 1, 1 };

    boolean needsFace() {
        return smooth > 0 || eyes > 0 || slim > 0 || nose > 0 || lips > 0 || blush > 0 || brows > 0;
    }

    static float[] rgb(String hex) {
        try {
            int c = Color.parseColor(hex);
            return new float[] { Color.red(c) / 255f, Color.green(c) / 255f, Color.blue(c) / 255f };
        } catch (Exception e) {
            return new float[] { 0.8f, 0.5f, 0.5f };
        }
    }

    private static float pct(JSONObject o, String k) {
        double v = o.optDouble(k, 0);
        if (Double.isNaN(v)) return 0;
        return (float) Math.max(0, Math.min(100, v)) / 100f;
    }

    private static float[] floats(JSONObject o, String k, float[] fallback) {
        JSONArray a = o.optJSONArray(k);
        if (a == null || a.length() != fallback.length) return fallback;
        float[] out = new float[a.length()];
        for (int i = 0; i < out.length; i++) {
            double v = a.optDouble(i, fallback[i]);
            out[i] = Double.isNaN(v) ? fallback[i] : (float) v;
        }
        return out;
    }

    static Look copyOf(Look o) {
        Look l = new Look();
        l.smooth = o.smooth; l.bright = o.bright; l.warm = o.warm; l.eyes = o.eyes; l.slim = o.slim; l.nose = o.nose;
        l.lips = o.lips; l.blush = o.blush; l.brows = o.brows;
        l.lipShade = o.lipShade; l.blushShade = o.blushShade; l.browShade = o.browShade;
        l.color = o.color; l.wash = o.wash; l.compare = o.compare; l.posY = o.posY; l.view = o.view;
        return l;
    }

    static Look from(JSONObject o) {
        Look l = new Look();
        if (o == null) return l;
        JSONObject b = o.optJSONObject("look");
        if (b != null) {
            l.smooth = pct(b, "smooth"); l.bright = pct(b, "bright"); l.warm = pct(b, "warm");
            l.eyes = pct(b, "eyes"); l.slim = pct(b, "slim"); l.nose = pct(b, "nose");
            l.lips = pct(b, "lips"); l.blush = pct(b, "blush"); l.brows = pct(b, "brows");
            if (b.has("lipShade")) l.lipShade = rgb(b.optString("lipShade"));
            if (b.has("blushShade")) l.blushShade = rgb(b.optString("blushShade"));
            if (b.has("browShade")) l.browShade = rgb(b.optString("browShade"));
        }
        l.color = floats(o, "color", l.color);
        l.wash = floats(o, "wash", l.wash);
        l.view = floats(o, "view", l.view);
        l.compare = o.optBoolean("compare", false);
        double p = o.optDouble("posY", 0.5);
        l.posY = Double.isNaN(p) ? 0.5f : (float) Math.max(0, Math.min(1, p));
        return l;
    }
}
