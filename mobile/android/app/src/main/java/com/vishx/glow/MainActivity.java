package com.vishx.glow;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;
import com.vishx.glow.cutout.GlowCutoutPlugin;
import com.vishx.glow.image.GlowImagePlugin;

public class MainActivity extends BridgeActivity {
    // Android's font size setting scales all text in the app (up to 200% on Android 14+). Glow Studio
    // follows it up to 130%, which its screens are checked at; beyond that buttons and labels would
    // be cut off or cover the photo.
    private static final int MAX_TEXT_ZOOM = 130;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Glow Studio's own native plugins (app/src/main/java/com/vishx/glow).
        registerPlugin(GlowCutoutPlugin.class);
        registerPlugin(GlowImagePlugin.class);
        super.onCreate(savedInstanceState);
        capTextZoom();
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
