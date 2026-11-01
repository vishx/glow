package com.vishx.glow.cutout;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.segmentation.subject.Subject;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenter;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions;

import java.nio.FloatBuffer;

/**
 * The phone's own cutout for the editor's Person / Background areas: Google's ML Kit subject
 * segmentation, on the phone and free. Every subject in the photo comes back separately (a person,
 * a sofa, a bag...), each with its own soft mask, so the web app keeps the ones its face finder
 * says are people.
 *
 * people({ image: "data:image/jpeg;base64,..." }) resolves to
 *   { engine: "mlkit", width, height, subjects: [{ x, y, w, h, mw, mh, mask }] }
 * x, y, w, h are 0-1 of the image; mask is base64 of mw*mh bytes (0-255 confidence).
 */
@CapacitorPlugin(name = "GlowCutout")
public class GlowCutoutPlugin extends Plugin {
    private SubjectSegmenter segmenter;

    private SubjectSegmenter segmenter() {
        if (segmenter == null) {
            SubjectSegmenterOptions options = new SubjectSegmenterOptions.Builder()
                .enableMultipleSubjects(new SubjectSegmenterOptions.SubjectResultOptions.Builder().enableConfidenceMask().build())
                .build();
            segmenter = SubjectSegmentation.getClient(options);
        }
        return segmenter;
    }

    @PluginMethod
    public void people(PluginCall call) {
        String data = call.getString("image");
        if (data == null) { call.reject("No image"); return; }
        int comma = data.indexOf(',');
        byte[] bytes;
        try { bytes = Base64.decode(comma >= 0 ? data.substring(comma + 1) : data, Base64.DEFAULT); }
        catch (IllegalArgumentException e) { call.reject("Bad image"); return; }
        Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bmp == null) { call.reject("Bad image"); return; }
        final int W = bmp.getWidth(), H = bmp.getHeight();
        segmenter().process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener(result -> {
                JSArray list = new JSArray();
                for (Subject s : result.getSubjects()) {
                    FloatBuffer fb = s.getConfidenceMask();
                    if (fb == null) continue;
                    int mw = s.getWidth(), mh = s.getHeight();
                    byte[] m = new byte[mw * mh];
                    fb.rewind();
                    for (int i = 0; i < m.length && fb.hasRemaining(); i++) {
                        float v = fb.get();
                        m[i] = (byte) Math.max(0, Math.min(255, Math.round(v * 255f)));
                    }
                    JSObject o = new JSObject();
                    o.put("x", (double) s.getStartX() / W); o.put("y", (double) s.getStartY() / H);
                    o.put("w", (double) mw / W); o.put("h", (double) mh / H);
                    o.put("mw", mw); o.put("mh", mh);
                    o.put("mask", Base64.encodeToString(m, Base64.NO_WRAP));
                    list.put(o);
                }
                JSObject ret = new JSObject();
                ret.put("engine", "mlkit"); ret.put("width", W); ret.put("height", H); ret.put("subjects", list);
                call.resolve(ret);
            })
            .addOnFailureListener(e -> call.reject(e.getMessage() == null ? "Segmentation failed" : e.getMessage()));
    }
}
