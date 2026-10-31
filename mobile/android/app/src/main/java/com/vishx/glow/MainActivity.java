package com.vishx.glow;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.vishx.glow.camera.GlowCameraPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Glow Studio's own native camera (app/src/main/java/com/vishx/glow/camera).
        registerPlugin(GlowCameraPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
