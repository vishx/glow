import Foundation
import AVFoundation
import Capacitor
import MetalKit
import UIKit

/// Glow Studio's native camera for the iPhone app (the twin of GlowCameraPlugin.java on Android).
/// The camera picture is drawn natively with the live look behind the see-through web page, so the
/// web camera screen's buttons, looks and sliders stay as they are; the shutter takes a real
/// full-resolution photo with the look re-applied at full size.
@objc(GlowCameraPlugin)
public class GlowCameraPlugin: CAPPlugin, CAPBridgedPlugin, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate {
    public let identifier = "GlowCameraPlugin"
    public let jsName = "GlowCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLook", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTorch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLight", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
    ]
    private static let stillMax: CGFloat = 4032

    private let tracker = FaceTracker()
    private var renderer: BeautyRenderer?
    private var mtkView: MTKView?
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "glow.camera.session")
    private let videoQueue = DispatchQueue(label: "glow.camera.video")
    private let captureQueue = DispatchQueue(label: "glow.camera.capture")
    private let videoOutput = AVCaptureVideoDataOutput()
    private let photoOutput = AVCapturePhotoOutput()
    private var device: AVCaptureDevice?
    private var configured = false

    // Set and read from several queues (plugin calls, camera frames, drawing, photos), so behind a lock.
    private let frameLock = NSLock()
    private var frame: CVPixelBuffer?
    private var _look = Look()
    private var _mirror = true
    private var _light: Float = 255
    private var _awaitingFrame = false
    private var _capture: (call: CAPPluginCall, look: Look, processed: Bool, aspect: Double, mirror: Bool)?
    private func locked<T>(_ f: () -> T) -> T { frameLock.lock(); defer { frameLock.unlock() }; return f() }
    var look: Look { get { locked { _look } } set { locked { _look = newValue } } }
    var mirror: Bool { get { locked { _mirror } } set { locked { _mirror = newValue } } }
    private var light: Float { get { locked { _light } } set { locked { _light = newValue } } }
    /// Main queue only.
    private var pendingStart: CAPPluginCall? { didSet { let w = pendingStart != nil; locked { _awaitingFrame = w } } }
    private var cameraCount = 1
    private var lightAt: Double = 0   // video queue only
    private var sessionId = 0
    /// The renderer used for photos, made on first use and only touched on the photo queue.
    private var stillRenderer: BeautyRenderer?
    private var sentSeen = false, sentReady = false, sentFailed = false, forceFace = false
    private var faceSentAt: Double = 0

    public override func load() {
        NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: nil) { _ in
            FaceTracker.hot = ProcessInfo.processInfo.thermalState.rawValue >= ProcessInfo.ThermalState.serious.rawValue
        }
    }

    // ---------- Permission ----------

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        let s: String
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: s = "granted"
        case .denied, .restricted: s = "denied"
        default: s = "prompt"
        }
        call.resolve(["camera": s])
    }

    // ---------- Start and stop ----------

    @objc func start(_ call: CAPPluginCall) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: begin(call)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in
                if ok { self.begin(call) } else { call.reject("Camera access is off", "denied") }
            }
        default: call.reject("Camera access is off", "denied")
        }
    }

    private func begin(_ call: CAPPluginCall) {
        let wantFront = call.getString("facing", "user") != "environment"
        look = Look.from(call.options)
        tracker.start { [weak self] in self?.sendFace() }
        DispatchQueue.main.async {
            self.sessionId += 1
            let my = self.sessionId
            self.pendingStart?.reject("Replaced by a newer start", "stopped")
            self.pendingStart = nil
            guard self.showView() else { call.reject("Couldn't show the camera", "error"); return }
            self.sessionQueue.async {
                let front = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
                let back = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                guard let dev = (wantFront ? (front ?? back) : (back ?? front)) else {
                    DispatchQueue.main.async { self.hideView(); call.reject("No camera found", "none") }
                    return
                }
                self.mirror = dev.position == .front
                self.cameraCount = (front != nil ? 1 : 0) + (back != nil ? 1 : 0)
                do {
                    try self.configure(dev)
                } catch {
                    DispatchQueue.main.async { self.stopAll(); call.reject("Couldn't open the camera", "busy") }
                    return
                }
                self.frameLock.lock(); self.frame = nil; self.frameLock.unlock()
                DispatchQueue.main.async {
                    if my != self.sessionId { call.reject("Stopped", "stopped"); return }
                    self.pendingStart = call
                    DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                        if self.pendingStart === call && my == self.sessionId {
                            self.pendingStart = nil
                            self.stopAll()
                            call.reject("The camera is busy", "busy")
                        }
                    }
                }
                if !self.session.isRunning { self.session.startRunning() }
            }
        }
    }

    /// On the session queue: one camera in, preview frames (upright BGRA, not mirrored) and photos out.
    private func configure(_ dev: AVCaptureDevice) throws {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .photo
        for i in session.inputs { session.removeInput(i) }
        let input = try AVCaptureDeviceInput(device: dev)
        guard session.canAddInput(input) else { throw NSError(domain: "GlowCamera", code: 2) }
        session.addInput(input)
        device = dev
        if !configured {
            videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.setSampleBufferDelegate(self, queue: videoQueue)
            if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
            if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }
            configured = true
        }
        if #available(iOS 16.0, *) {
            if let best = dev.activeFormat.supportedMaxPhotoDimensions.last { photoOutput.maxPhotoDimensions = best }
        } else {
            photoOutput.isHighResolutionCaptureEnabled = true
        }
        for c in [videoOutput.connection(with: .video), photoOutput.connection(with: .video)].compactMap({ $0 }) {
            if #available(iOS 17.0, *) { if c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 } }
            else if c.isVideoOrientationSupported { c.videoOrientation = .portrait }
            if c.isVideoMirroringSupported { c.automaticallyAdjustsVideoMirroring = false; c.isVideoMirrored = false }
        }
        // A steady 30 frames a second at most: more only heats the phone.
        try? dev.lockForConfiguration()
        dev.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 15)
        dev.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 30)
        dev.unlockForConfiguration()
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.sessionId += 1
            self.pendingStart?.reject("Stopped", "stopped")
            self.pendingStart = nil
            self.stopAll()
            call.resolve()
        }
    }

    private func stopAll() {
        sessionQueue.async { if self.session.isRunning { self.session.stopRunning() } }
        hideView()
        tracker.reset()
        frameLock.lock(); frame = nil; frameLock.unlock()
    }

    private func showView() -> Bool {
        guard let web = bridge?.webView, let parent = web.superview else { return false }
        if mtkView == nil {
            guard let r = BeautyRenderer(tracker: tracker) else { return false }
            r.host = self
            renderer = r
            let v = MTKView(frame: parent.bounds, device: r.device)
            v.colorPixelFormat = .bgra8Unorm
            v.framebufferOnly = true
            v.preferredFramesPerSecond = 30
            v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            v.delegate = r
            v.isUserInteractionEnabled = false
            mtkView = v
        }
        if let v = mtkView, v.superview == nil { v.frame = parent.bounds; parent.insertSubview(v, belowSubview: web) }
        // The page is see-through on the camera screen (html.native-cam), so the picture shows behind it.
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        mtkView?.isPaused = false
        return true
    }

    private func hideView() {
        if let web = bridge?.webView {
            web.isOpaque = true
            web.backgroundColor = UIColor(red: 0x12 / 255.0, green: 0x10 / 255.0, blue: 0x14 / 255.0, alpha: 1)
        }
        // Kept (just taken off screen) so the next start doesn't rebuild the view and recompile the shader.
        mtkView?.isPaused = true
        mtkView?.removeFromSuperview()
    }

    /// The viewfinder's box (fractions of the page) in drawable pixels, top-left origin.
    func viewRect(_ f: [Float], drawable: CGSize) -> CGRect {
        guard let web = bridge?.webView, let v = mtkView, v.bounds.width > 0 else { return CGRect(origin: .zero, size: drawable) }
        let inset = web.scrollView.adjustedContentInset
        let page = web.frame.inset(by: inset)
        let sx = drawable.width / v.bounds.width, sy = drawable.height / v.bounds.height
        let x = page.minX + CGFloat(f[0]) * page.width, y = page.minY + CGFloat(f[1]) * page.height
        return CGRect(x: x * sx, y: y * sy, width: CGFloat(f[2]) * page.width * sx, height: CGFloat(f[3]) * page.height * sy)
    }

    func latestFrame() -> CVPixelBuffer? { frameLock.lock(); defer { frameLock.unlock() }; return frame }

    // ---------- Frames ----------

    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pb = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        frameLock.lock(); frame = pb; frameLock.unlock()
        let W = CVPixelBufferGetWidth(pb), H = CVPixelBufferGetHeight(pb)
        // Only the first frame after a start needs the main queue (to answer the start call).
        if locked({ _awaitingFrame }) { DispatchQueue.main.async {
            guard let c = self.pendingStart else { return }
            self.pendingStart = nil
            c.resolve(["width": W, "height": H, "torch": self.device?.hasTorch ?? false, "cameras": self.cameraCount,
                       "facing": self.mirror ? "user" : "environment"])
            self.forceFace = true
            self.sendFace()
        } }
        let now = CACurrentMediaTime()
        if now - lightAt > 0.4 { lightAt = now; light = measureLight(pb) }
        if !look.needsFace {
            if tracker.snap().pts != nil { tracker.reset(); sendFace() }
        } else if tracker.canSend(now) {
            tracker.detect(pb, W: W, H: H) { [weak self] in self?.sendFace() }
        }
    }

    /// Average brightness of the picture (0-255), from a 24×24 grid of samples.
    private func measureLight(_ pb: CVPixelBuffer) -> Float {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pb)?.assumingMemoryBound(to: UInt8.self) else { return 255 }
        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb), rs = CVPixelBufferGetBytesPerRow(pb)
        var t: Float = 0
        for y in 0..<24 { for x in 0..<24 {
            let i = (y * h / 24) * rs + (x * w / 24) * 4   // BGRA
            t += 0.114 * Float(base[i]) + 0.587 * Float(base[i + 1]) + 0.299 * Float(base[i + 2])
        } }
        return t / 576
    }

    /// Tells the page whether a face is in view (for the Adjust panel's notes) and where (to keep it in sight).
    private func sendFace() {
        DispatchQueue.main.async {
            let s = self.tracker.snap()
            let seen = s.seen > 0 && s.pts != nil
            let now = CACurrentMediaTime()
            let changed = seen != self.sentSeen || self.tracker.ready != self.sentReady || self.tracker.failed != self.sentFailed
            if !changed && !self.forceFace && !(seen && now - self.faceSentAt > 0.15) { return }
            self.forceFace = false
            self.sentSeen = seen; self.sentReady = self.tracker.ready; self.sentFailed = self.tracker.failed; self.faceSentAt = now
            var o: [String: Any] = ["ready": self.tracker.ready, "failed": self.tracker.failed, "seen": seen]
            if self.tracker.failed { o["error"] = self.tracker.error }
            if seen, let p = s.pts, s.H > 0 { o["cy"] = (p[FaceGeometry.BROW * 2 + 1] + p[FaceGeometry.CHIN * 2 + 1]) / 2 / Float(s.H) }
            self.notifyListeners("face", data: o)
        }
    }

    // ---------- Settings ----------

    @objc func setLook(_ call: CAPPluginCall) {
        look = Look.from(call.options)
        call.resolve()
    }

    @objc func setTorch(_ call: CAPPluginCall) {
        let on = call.getBool("on", false)
        sessionQueue.async {
            guard let d = self.device, d.hasTorch else { call.reject("No flash"); return }
            do { try d.lockForConfiguration(); d.torchMode = on ? .on : .off; d.unlockForConfiguration(); call.resolve() }
            catch { call.reject("No flash") }
        }
    }

    @objc func getLight(_ call: CAPPluginCall) { call.resolve(["light": light]) }

    // ---------- Shutter ----------

    @objc func capture(_ call: CAPPluginCall) {
        let lk = Look.from(call.options)
        let processed = call.getBool("processed", true)
        let aspect = call.getDouble("aspect") ?? 0
        sessionQueue.async {
            let mir = self.mirror
            let busy: Bool = self.locked {
                if self._capture != nil { return true }
                self._capture = (call, lk, processed, aspect, mir); return false
            }
            guard !busy else { call.reject("The camera isn't ready"); return }
            guard self.session.isRunning else { self.locked { self._capture = nil }; call.reject("The camera isn't ready"); return }
            let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
            if #available(iOS 16.0, *) { settings.maxPhotoDimensions = self.photoOutput.maxPhotoDimensions }
            else { settings.isHighResolutionPhotoEnabled = true }
            self.photoOutput.capturePhoto(with: settings, delegate: self)
        }
    }

    public func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        guard let job: (call: CAPPluginCall, look: Look, processed: Bool, aspect: Double, mirror: Bool) = locked({ let j = _capture; _capture = nil; return j }) else { return }
        guard error == nil, let data = photo.fileDataRepresentation(), let ui = UIImage(data: data) else {
            job.call.reject("Couldn't take the photo."); return
        }
        captureQueue.async {
            do { try self.finish(job.call, ui, job.look, job.processed, job.aspect, job.mirror) }
            catch { job.call.reject("Couldn't take the photo.") }
        }
    }

    /// Upright, cropped to what the screen showed, mirrored like the preview; the look baked into a second copy.
    private func finish(_ call: CAPPluginCall, _ ui: UIImage, _ lk: Look, _ processed: Bool, _ aspect: Double, _ mir: Bool) throws {
        let s = min(1, GlowCameraPlugin.stillMax / max(ui.size.width, ui.size.height))
        var W = (ui.size.width * s).rounded(), H = (ui.size.height * s).rounded()
        var cw = W, ch = H
        if aspect > 0 { if Double(W / H) > aspect { cw = (H * CGFloat(aspect)).rounded() } else { ch = (W / CGFloat(aspect)).rounded() } }
        cw = max(1, min(W, cw)); ch = max(1, min(H, ch))
        let cx = ((W - cw) / 2).rounded(), cy = ((H - ch) * CGFloat(lk.posY)).rounded()
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1; fmt.opaque = true
        // The crop, upright (UIImage applies the photo's orientation), not mirrored.
        let crop = UIGraphicsImageRenderer(size: CGSize(width: cw, height: ch), format: fmt).image { _ in
            ui.draw(in: CGRect(x: -cx, y: -cy, width: W, height: H))
        }
        W = cw; H = ch
        let raw = mir ? UIGraphicsImageRenderer(size: crop.size, format: fmt).image { ctx in
            ctx.cgContext.translateBy(x: cw, y: 0); ctx.cgContext.scaleBy(x: -1, y: 1); crop.draw(at: .zero)
        } : crop
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        let dir = FileManager.default.temporaryDirectory
        if let old = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) {
            for f in old where f.lastPathComponent.hasPrefix("glowcam-") {
                if let d = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate, Date().timeIntervalSince(d) > 600 {
                    try? FileManager.default.removeItem(at: f)
                }
            }
        }
        let rawURL = dir.appendingPathComponent("glowcam-\(stamp)-raw.jpg")
        guard let rawData = raw.jpegData(compressionQuality: 0.92) else { throw NSError(domain: "GlowCamera", code: 3) }
        try rawData.write(to: rawURL)
        var res: [String: Any] = ["raw": rawURL.path, "width": Int(W), "height": Int(H)]
        if processed, let cg = crop.cgImage {
            let sm = min(1, 960 / max(W, H))
            let small = UIGraphicsImageRenderer(size: CGSize(width: (W * sm).rounded(), height: (H * sm).rounded()), format: fmt).image { _ in
                crop.draw(in: CGRect(x: 0, y: 0, width: (W * sm).rounded(), height: (H * sm).rounded()))
            }
            let P = tracker.detectStill(small, W: Int(W), H: Int(H))
            if stillRenderer == nil { stillRenderer = BeautyRenderer(tracker: tracker) }
            if let out = stillRenderer?.renderStill(cg, P: P, look: lk, mirror: mir),
               let data = UIImage(cgImage: out).jpegData(compressionQuality: 0.92) {
                let url = dir.appendingPathComponent("glowcam-\(stamp).jpg")
                try data.write(to: url)
                res["processed"] = url.path
            }
        }
        call.resolve(res)
    }
}
