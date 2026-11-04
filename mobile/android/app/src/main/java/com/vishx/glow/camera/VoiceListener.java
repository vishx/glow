package com.vishx.glow.camera;

import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;
import java.util.ArrayList;

/**
 * Voice commands (like a Galaxy's Shooting methods → Voice commands): listens with the phone's own
 * speech recognition while the camera is open, on the phone where it can (Android 12+ on-device
 * recognizer), and passes what it hears to the page, which looks for the photo words ("Cheese",
 * "Smile", "Capture", "Shoot"). A recognizer stops after each thing said or a silence, so it is
 * started again until turned off. Main thread only (SpeechRecognizer needs it).
 */
final class VoiceListener {
    private static final String TAG = "GlowCamera";

    interface Listener {
        /** What was heard so far of one thing said; `id` names that thing said. */
        void onText(String text, int id);
        /** "denied" (no microphone permission), "unavailable" or "failed" (stopped for good). */
        void onError(String error);
    }

    private final Context ctx;
    private final Listener l;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    private boolean on, muted;
    private int id, fails;
    private final Runnable restart = this::listen;
    private final Runnable unmute = this::unmute;

    VoiceListener(Context ctx, Listener l) { this.ctx = ctx.getApplicationContext(); this.l = l; }

    static boolean available(Context ctx) {
        if (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)) return true;
        return SpeechRecognizer.isRecognitionAvailable(ctx);
    }

    boolean isOn() { return on; }

    void setOn(boolean v) {
        if (v == on) return;
        on = v;
        if (v) { fails = 0; listen(); } else stop();
    }

    private void make() {
        if (rec != null) return;
        if (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)) {
            rec = SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx);
        } else rec = SpeechRecognizer.createSpeechRecognizer(ctx);
        rec.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle b) { fails = 0; }
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float db) {}
            @Override public void onBufferReceived(byte[] b) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onEvent(int type, Bundle b) {}
            @Override public void onPartialResults(Bundle b) { send(b); }
            @Override public void onResults(Bundle b) { send(b); again(150); }
            @Override public void onError(int e) {
                if (!on) return;
                if (e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) { on = false; stop(); l.onError("denied"); return; }
                if (e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) { again(150); return; }
                // Busy, network, server, client...: wait a little, and give up after many in a row.
                if (++fails > 8) { on = false; stop(); l.onError("failed"); return; }
                if (e == SpeechRecognizer.ERROR_CLIENT || e == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) destroy();
                again(800L * Math.min(fails, 4));
            }
        });
    }

    private void send(Bundle b) {
        ArrayList<String> r = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (r == null || r.isEmpty() || !on) return;
        StringBuilder t = new StringBuilder();
        for (int i = 0; i < Math.min(3, r.size()); i++) { if (i > 0) t.append(' '); t.append(r.get(i)); }
        l.onText(t.toString(), id);
    }

    private void again(long ms) {
        main.removeCallbacks(restart);
        if (on) main.postDelayed(restart, ms);
    }

    private void listen() {
        if (!on) return;
        try {
            make();
            id++;
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.getPackageName());
            // Some recognizers chime each time they start listening: hushed for a moment, as the
            // camera keeps listening over and over.
            mute();
            rec.startListening(i);
        } catch (Throwable t) {
            Log.w(TAG, "voice listen", t);
            destroy();
            if (++fails > 8) { on = false; unmute(); l.onError("failed"); } else again(1000);
        }
    }

    private void mute() {
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null || am.isMusicActive()) return;   // never hush music the person is playing
        try { am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0); muted = true; } catch (Throwable ignored) {}
        main.removeCallbacks(unmute);
        main.postDelayed(unmute, 700);
    }

    private void unmute() {
        if (!muted) return;
        muted = false;
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        try { if (am != null) am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0); } catch (Throwable ignored) {}
    }

    private void destroy() {
        if (rec == null) return;
        try { rec.cancel(); } catch (Throwable ignored) {}
        try { rec.destroy(); } catch (Throwable ignored) {}
        rec = null;
    }

    private void stop() {
        main.removeCallbacks(restart);
        main.removeCallbacks(unmute);
        unmute();
        destroy();
    }
}
