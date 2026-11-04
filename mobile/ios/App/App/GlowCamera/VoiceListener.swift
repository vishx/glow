import Foundation
import AVFoundation
import Speech

/// Voice commands (like a Galaxy's Shooting methods → Voice commands): listens with Apple's speech
/// recognition while the camera is open, on the phone where it can, and passes what it hears to the
/// page, which looks for the photo words ("Cheese", "Smile", "Capture", "Shoot"). A recognition
/// lasts about a minute at most, so it is started again until turned off. Main queue only.
final class VoiceListener {
    /// What was heard so far of one thing said; `id` names that thing said.
    var onText: ((String, Int) -> Void)?
    /// "denied", "unavailable" or "failed" (stopped for good).
    var onError: ((String) -> Void)?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var restartTimer: Timer?
    private(set) var on = false
    private var id = 0
    private var fails = 0
    private var tapped = false

    /// Asks for the microphone and speech recognition (the first time), then answers
    /// "ok", "denied" or "unavailable".
    static func authorize(_ done: @escaping (String) -> Void) {
        guard let r = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), r.isAvailable || r.supportsOnDeviceRecognition else {
            DispatchQueue.main.async { done("unavailable") }; return
        }
        SFSpeechRecognizer.requestAuthorization { st in
            guard st == .authorized else { DispatchQueue.main.async { done("denied") }; return }
            AVAudioSession.sharedInstance().requestRecordPermission { ok in
                DispatchQueue.main.async { done(ok ? "ok" : "denied") }
            }
        }
    }

    func setOn(_ v: Bool) {
        if v == on { return }
        on = v
        if v { fails = 0; start() } else { stop(); deactivate() }
    }

    private func start() {
        guard on, let rec = recognizer else { return }
        stop()
        do {
            let s = AVAudioSession.sharedInstance()
            // Mixes with whatever is playing, and keeps the speaker for the shutter sound.
            try s.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker, .allowBluetooth])
            try s.setActive(true, options: [])
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            if rec.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
            req.taskHint = .confirmation
            request = req
            let input = engine.inputNode
            let fmt = input.outputFormat(forBus: 0)
            guard fmt.sampleRate > 0 else { throw NSError(domain: "GlowCamera", code: 3) }
            input.installTap(onBus: 0, bufferSize: 1024, format: fmt) { [weak req] buf, _ in req?.append(buf) }
            tapped = true
            engine.prepare()
            try engine.start()
            id += 1
            let mine = id
            task = rec.recognitionTask(with: req) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self = self, self.on, self.id == mine else { return }
                    if let r = result {
                        self.fails = 0
                        let text = r.transcriptions.prefix(3).map { $0.formattedString }.joined(separator: " ")
                        self.onText?(text, mine)
                        if r.isFinal { self.again(0.15) }
                    } else if error != nil {
                        self.fails += 1
                        if self.fails > 8 { self.on = false; self.stop(); self.deactivate(); self.onError?("failed") }
                        else { self.again(self.fails > 1 ? 1.0 : 0.15) }
                    }
                }
            }
            // A recognition is limited to about a minute: a fresh one every 50 seconds.
            restartTimer = Timer.scheduledTimer(withTimeInterval: 50, repeats: false) { [weak self] _ in self?.start() }
        } catch {
            stop()
            fails += 1
            if fails > 8 { on = false; deactivate(); onError?("failed") } else { again(1.0) }
        }
    }

    private func again(_ secs: TimeInterval) {
        restartTimer?.invalidate()
        guard on else { return }
        restartTimer = Timer.scheduledTimer(withTimeInterval: secs, repeats: false) { [weak self] _ in self?.start() }
    }

    private func stop() {
        restartTimer?.invalidate(); restartTimer = nil
        task?.cancel(); task = nil
        request?.endAudio(); request = nil
        if engine.isRunning { engine.stop() }
        if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
    }

    private func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
}
