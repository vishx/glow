package com.vishx.glow.image;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;

/**
 * Opens photos the app's WebView can't: HEIC/HEIF (Samsung "High efficiency pictures", photos sent
 * from iPhones). Android's own decoder reads them, turned the right way up, and hands back a JPEG.
 *
 * toJpeg({ data: "data:image/heic;base64,...", max: 8192 }) resolves to
 *   { data: "data:image/jpeg;base64,...", width, height }
 *
 * pasteImage({ max: 2048 }) reads a picture copied to the phone's clipboard ("Copy image" in
 * Chrome, Samsung Gallery, Pinterest, a screenshot's Copy), which the WebView's own
 * navigator.clipboard.read() can't do. Resolves to { data, width, height }, or { empty: true }
 * when the clipboard holds no picture. A picture with see-through parts comes back as PNG.
 */
@CapacitorPlugin(name = "GlowImage")
public class GlowImagePlugin extends Plugin {
    @PluginMethod
    public void toJpeg(PluginCall call) {
        String data = call.getString("data");
        final int max = call.getInt("max", 8192);
        if (data == null) { call.reject("No image"); return; }
        int comma = data.indexOf(',');
        final byte[] bytes;
        try { bytes = Base64.decode(comma >= 0 ? data.substring(comma + 1) : data, Base64.DEFAULT); }
        catch (IllegalArgumentException e) { call.reject("Bad image"); return; }
        new Thread(() -> {
            try {
                Bitmap bmp;
                if (Build.VERSION.SDK_INT >= 28) {
                    bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes)), (decoder, info, src) -> {
                        decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                        int w = info.getSize().getWidth(), h = info.getSize().getHeight(), big = Math.max(w, h);
                        if (big > max) { float k = (float) max / big; decoder.setTargetSize(Math.round(w * k), Math.round(h * k)); }
                    });
                } else {
                    bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                }
                if (bmp == null) { call.reject("Can't read this photo"); return; }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                bmp.compress(Bitmap.CompressFormat.JPEG, 94, out);
                JSObject ret = new JSObject();
                ret.put("data", "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                ret.put("width", bmp.getWidth()); ret.put("height", bmp.getHeight());
                bmp.recycle();
                call.resolve(ret);
            } catch (Throwable e) {
                call.reject(e.getMessage() == null ? "Can't read this photo" : e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void pasteImage(PluginCall call) {
        final int max = call.getInt("max", 2048);
        final Context c = getContext();
        final ClipData clip;
        try {
            ClipboardManager cm = (ClipboardManager) c.getSystemService(Context.CLIPBOARD_SERVICE);
            clip = cm == null ? null : cm.getPrimaryClip();
        } catch (Throwable e) { call.reject("Can't read the clipboard"); return; }
        if (clip == null || clip.getItemCount() == 0) { call.resolve(empty()); return; }
        new Thread(() -> {
            ContentResolver cr = c.getContentResolver();
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri == null) continue;
                try {
                    String type = cr.getType(uri);
                    if (type != null && !type.startsWith("image/")) continue;
                    byte[] bytes;
                    try (InputStream in = cr.openInputStream(uri)) {
                        if (in == null) continue;
                        ByteArrayOutputStream buf = new ByteArrayOutputStream();
                        byte[] chunk = new byte[65536]; int n;
                        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
                        bytes = buf.toByteArray();
                    }
                    Bitmap bmp = decode(bytes, max);
                    if (bmp == null) continue;
                    boolean png = bmp.hasAlpha();
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    bmp.compress(png ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG, 92, out);
                    JSObject ret = new JSObject();
                    ret.put("data", "data:image/" + (png ? "png" : "jpeg") + ";base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                    ret.put("width", bmp.getWidth()); ret.put("height", bmp.getHeight());
                    bmp.recycle();
                    call.resolve(ret);
                    return;
                } catch (Throwable e) {
                    // Not readable (the app that copied it took its permission back): try the next item.
                }
            }
            call.resolve(empty());
        }).start();
    }

    private static JSObject empty() { JSObject r = new JSObject(); r.put("empty", true); return r; }

    private static Bitmap decode(byte[] bytes, int max) throws Exception {
        if (Build.VERSION.SDK_INT >= 28) {
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes)), (decoder, info, src) -> {
                decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                int w = info.getSize().getWidth(), h = info.getSize().getHeight(), big = Math.max(w, h);
                if (big > max) { float k = (float) max / big; decoder.setTargetSize(Math.round(w * k), Math.round(h * k)); }
            });
        }
        BitmapFactory.Options o = new BitmapFactory.Options(); o.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, o);
        int big = Math.max(o.outWidth, o.outHeight), sample = 1;
        while (big / (sample * 2) >= max) sample *= 2;
        BitmapFactory.Options d = new BitmapFactory.Options(); d.inSampleSize = sample;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, d);
    }
}
