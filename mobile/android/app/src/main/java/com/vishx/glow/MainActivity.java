package com.vishx.glow;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.vishx.glow.cutout.GlowCutoutPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Glow Studio's own native plugins (app/src/main/java/com/vishx/glow).
        registerPlugin(GlowCutoutPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
