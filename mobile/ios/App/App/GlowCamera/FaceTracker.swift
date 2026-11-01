import Foundation
import CoreVideo
import CoreImage
import UIKit
import MediaPipeTasksVision

/// Follows the face in the camera frames with MediaPipe's face landmarker: the same model and the
/// same 478 points as the web camera (faceworker.js) and the Android camera, so looks match everywhere.
/// Runs on its own queue so the preview never waits for it.
final class FaceTracker {
    static var hot = false   // the phone is warm: track less often

    private let queue = DispatchQueue(label: "glow.face")
    private var video: FaceLandmarker?
    private var still: FaceLandmarker?
    private(set) var started = false
    private(set) var ready = false
    private(set) var failed = false
    private(set) var error = ""
    private var busy = false
    private var sentAt: Double = 0
    private var lastTs = 0

    private let lock = NSLock()
    private var pts: [Float]?
    private var W = 0, H = 0
    private var seen: Float = 0

    struct Snap { var pts: [Float]?; var W: Int; var H: Int; var seen: Float }

    private static func modelPath() -> String? {
        Bundle.main.path(forResource: "face_landmarker", ofType: "task", inDirectory: "public/vendor")
    }

    private func make(_ mode: RunningMode) throws -> FaceLandmarker {
        guard let path = FaceTracker.modelPath() else { throw NSError(domain: "GlowCamera", code: 1, userInfo: [NSLocalizedDescriptionKey: "face model missing"]) }
        let o = FaceLandmarkerOptions()
        o.baseOptions.modelAssetPath = path
        o.runningMode = mode
        o.numFaces = 1
        return try FaceLandmarker(options: o)
    }

    func start(_ onChange: @escaping () -> Void) {
        if started { return }
        started = true
        queue.async {
            do { self.video = try self.make(.video); self.ready = true; self.failed = false }
            catch { self.failed = true; self.error = error.localizedDescription }
            onChange()
        }
    }

    /// Frames with no face in view are checked about 5 times a second, to save battery.
    func canSend(_ now: Double) -> Bool {
        if busy && now - sentAt > 4 { busy = false }
        lock.lock(); let s = seen; lock.unlock()
        let gap = s > 0 ? (FaceTracker.hot ? 0.09 : 0.03) : (FaceTracker.hot ? 0.4 : 0.2)
        return ready && !busy && now - sentAt >= gap
    }

    private static let ci = CIContext(options: [.useSoftwareRenderer: false])
    /// The picture turned `turn` degrees clockwise.
    static func turned(_ im: CIImage, _ turn: Int) -> UIImage? {
        // Core Image's y axis points up, so a clockwise turn on screen is a negative angle.
        var r = im.transformed(by: CGAffineTransform(rotationAngle: -CGFloat(turn) * .pi / 180))
        r = r.transformed(by: CGAffineTransform(translationX: -r.extent.origin.x, y: -r.extent.origin.y))
        guard let cg = ci.createCGImage(r, from: CGRect(x: 0, y: 0, width: r.extent.width.rounded(), height: r.extent.height.rounded())) else { return nil }
        return UIImage(cgImage: cg)
    }
    /// Normalised points found in a copy turned `turn` degrees clockwise, back in the unturned picture.
    static func unturn(_ n: [Float]?, _ turn: Int) -> [Float]? {
        guard var o = n, turn != 0 else { return n }
        for i in stride(from: 0, to: o.count, by: 2) {
            let x = o[i], y = o[i + 1]
            switch turn {
            case 90: o[i] = y; o[i + 1] = 1 - x
            case 180: o[i] = 1 - x; o[i + 1] = 1 - y
            default: o[i] = 1 - y; o[i + 1] = x   // 270
            }
        }
        return o
    }

    /// turn: degrees clockwise the picture is turned first, so a face in a sideways-held phone is upright for the model.
    func detect(_ pb: CVPixelBuffer, W fw: Int, H fh: Int, turn: Int = 0, _ onChange: @escaping () -> Void) {
        busy = true
        sentAt = CACurrentMediaTime()
        queue.async {
            var norm: [Float]?
            let img: MPImage? = turn == 0 ? (try? MPImage(pixelBuffer: pb, orientation: .up))
                : FaceTracker.turned(CIImage(cvPixelBuffer: pb), turn).flatMap { try? MPImage(uiImage: $0) }
            if let v = self.video, let img = img {
                let ts = max(self.lastTs + 1, Int(CACurrentMediaTime() * 1000))
                self.lastTs = ts
                norm = FaceTracker.unturn(FaceTracker.first(try? v.detect(videoFrame: img, timestampInMilliseconds: ts)), turn)
            }
            self.take(norm, fw, fh)
            self.busy = false
            onChange()
        }
    }

    private static func first(_ r: FaceLandmarkerResult?) -> [Float]? {
        guard let f = r?.faceLandmarks.first, f.count >= 478 else { return nil }
        var out = [Float](repeating: 0, count: f.count * 2)
        for (i, p) in f.enumerated() {
            if !p.x.isFinite || !p.y.isFinite { return nil }
            out[i * 2] = p.x; out[i * 2 + 1] = p.y
        }
        return out
    }

    /// Eases the points toward the new ones, so makeup doesn't shimmer when the face is still.
    private func take(_ norm: [Float]?, _ fw: Int, _ fh: Int) {
        lock.lock(); defer { lock.unlock() }
        guard let norm = norm else { seen = max(0, seen - 0.34); return }
        var raw = norm
        for i in stride(from: 0, to: raw.count, by: 2) { raw[i] *= Float(fw); raw[i + 1] *= Float(fh) }
        if let old = pts, seen > 0, old.count == raw.count, W == fw, H == fh {
            let faceW = max(1, FaceGeometry.dist(raw, FaceGeometry.CHEEK_L, FaceGeometry.CHEEK_R))
            var move: Float = 0
            for i in [1, 33, 263, 61, 291, 152] { move += hypotf(raw[i * 2] - old[i * 2], raw[i * 2 + 1] - old[i * 2 + 1]) }
            move = move / 6 / faceW
            let k = min(1, 0.4 + move * 12)
            var eased = raw
            for i in 0..<raw.count { eased[i] = old[i] + (raw[i] - old[i]) * k }
            pts = eased
        } else {
            pts = raw
        }
        W = fw; H = fh
        seen = min(1, seen + 0.5)
    }

    func reset() { lock.lock(); pts = nil; seen = 0; lock.unlock() }
    func forgetIfGone() { lock.lock(); if seen == 0 { pts = nil }; lock.unlock() }
    func snap() -> Snap { lock.lock(); defer { lock.unlock() }; return Snap(pts: pts, W: W, H: H, seen: seen) }

    /// Finds the face in a still photo; the points come back in the photo's pixels.
    func detectStill(_ image: UIImage, W: Int, H: Int, turn: Int = 0) -> [Float]? {
        return queue.sync {
            if still == nil { still = try? make(.image) }
            var src = image
            if turn != 0, let cg = image.cgImage, let t = FaceTracker.turned(CIImage(cgImage: cg), turn) { src = t }
            guard let s = still, let img = try? MPImage(uiImage: src),
                  var n = FaceTracker.unturn(FaceTracker.first(try? s.detect(image: img)), turn) else { return nil }
            for i in stride(from: 0, to: n.count, by: 2) { n[i] *= Float(W); n[i + 1] *= Float(H) }
            return n
        }
    }
}
