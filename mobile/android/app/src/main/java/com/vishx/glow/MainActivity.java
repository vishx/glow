package com.vishx.glow;

import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;
import com.vishx.glow.home.GlowHomePlugin;
import com.vishx.glow.cutout.GlowCutoutPlugin;
import com.vishx.glow.image.GlowImagePlugin;
import com.vishx.glow.camera.GlowCameraPlugin;

public class MainActivity extends BridgeActivity {
    // Android's font size setting scales all text in the app (up to 200% on Android 14+). Glow Studio
    // follows it up to 130%, which its screens are checked at; beyond that buttons and labels would
    // be cut off or cover the photo.
    private static final int MAX_TEXT_ZOOM = 130;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Glow Studio's own native plugins (app/src/main/java/com/vishx/glow).
        registerPlugin(GlowHomePlugin.class);
        registerPlugin(GlowCutoutPlugin.class);
        registerPlugin(GlowImagePlugin.class);
        registerPlugin(GlowCameraPlugin.class);
        super.onCreate(savedInstanceState);
        capTextZoom();
    }

    // The volume buttons work the camera's shutter (or zoom) while the camera is open, like a
    // phone's own camera; the camera screen's settings choose ("Press volume buttons to").
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if ((k == KeyEvent.KEYCODE_VOLUME_UP || k == KeyEvent.KEYCODE_VOLUME_DOWN)
            && (e.getAction() == KeyEvent.ACTION_DOWN || e.getAction() == KeyEvent.ACTION_UP)
            && GlowCameraPlugin.onVolumeKey(k, e.getAction() == KeyEvent.ACTION_DOWN, e.getRepeatCount())) return true;
        return super.dispatchKeyEvent(e);
    }

    private void capTextZoom() {
        try {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            WebSettings s = getBridge().getWebView().getSettings();
            int system = Math.round(getResources().getConfiguration().fontScale * 100);
            s.setTextZoom(Math.max(85, Math.min(system, MAX_TEXT_ZOOM)));
        } catch (Exception ignored) {
            // Keep the WebView's own setting.
        }
    }
}
