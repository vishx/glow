package com.vishx.glow.home;

import android.content.Context;
import android.content.Intent;

import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.vishx.glow.R;

/**
 * "Add Glow Studio to your home screen": asks the phone's launcher to pin a Glow Studio icon
 * (Android 8+ ShortcutManager.requestPinShortcut). The launcher shows its own confirm dialog with
 * the icon, so nothing is added without the person tapping Add. Apps can't put an icon there on
 * their own, and can't see whether the launcher already shows the normal app icon, so the web app
 * asks once and offers "It's already there".
 *
 * status() resolves to { supported, pinned }: pinned is true once our own shortcut is on the home screen.
 * pin()    resolves to { requested }: false when this launcher can't pin icons.
 */
@CapacitorPlugin(name = "GlowHome")
public class GlowHomePlugin extends Plugin {
    private static final String ID = "glow-studio-home";

    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("supported", supported(c));
        r.put("pinned", pinned(c));
        call.resolve(r);
    }

    @PluginMethod
    public void pin(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        if (!supported(c)) { r.put("requested", false); call.resolve(r); return; }
        try {
            Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
            if (open == null) open = new Intent(c, getActivity().getClass());
            open.setAction(Intent.ACTION_MAIN);
            ShortcutInfoCompat info = new ShortcutInfoCompat.Builder(c, ID)
                .setShortLabel(c.getString(R.string.app_name))
                .setLongLabel(c.getString(R.string.app_name))
                .setIcon(IconCompat.createWithResource(c, R.mipmap.ic_launcher))
                .setIntent(open)
                .build();
            r.put("requested", ShortcutManagerCompat.requestPinShortcut(c, info, null));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Couldn't add the icon", e);
        }
    }

    private static boolean supported(Context c) {
        try { return ShortcutManagerCompat.isRequestPinShortcutSupported(c); } catch (Exception e) { return false; }
    }

    private static boolean pinned(Context c) {
        try {
            for (ShortcutInfoCompat s : ShortcutManagerCompat.getShortcuts(c, ShortcutManagerCompat.FLAG_MATCH_PINNED)) {
                if (ID.equals(s.getId())) return true;
            }
        } catch (Exception e) { /* older androidx or launcher: treat as not pinned */ }
        return false;
    }
}
