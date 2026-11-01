package com.vishx.glow.image;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Opens photos the app's WebView can't: HEIC/HEIF (Samsung "High efficiency pictures", photos sent
 * from iPhones). Android's own decoder reads them, turned the right way up, and hands back a JPEG.
 *
 * toJpeg({ data: "data:image/heic;base64,...", max: 8192 }) resolves to
 *   { data: "data:image/jpeg;base64,...", width, height }
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
}
