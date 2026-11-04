import Foundation
import CoreVideo
import CoreImage
import UIKit
import MediaPipeTasksVision

/// "Show palm" (like a Galaxy's Shooting methods): looks for an open hand facing the camera with
/// MediaPipe's gesture recognizer (the same model as Android and the web camera's palmworker.js),
/// about six times a second on its own queue. The page decides when a palm has been held long
/// enough and takes the photo; this only reports what it sees.
final class PalmTracker {
    private let queue = DispatchQueue(label: "glow.palm")
    private var rec: GestureRecognizer?
    private(set) var on = false
    private(set) var ready = false
    private(set) var failed = false
    private var starting = false
    private var busy = false
    private var sentAt: Double = 0
    private var lastTs = 0

    func setOn(_ v: Bool) {
        on = v
        if !v || ready || failed || starting { return }
        starting = true
        queue.async {
            do {
                guard let path = Bundle.main.path(forResource: "gesture_recognizer", ofType: "task", inDirectory: "public/vendor") else {
                    throw NSError(domain: "GlowCamera", code: 2, userInfo: [NSLocalizedDescriptionKey: "palm model missing"])
                }
                let o = GestureRecognizerOptions()
                o.baseOptions.modelAssetPath = path
                o.runningMode = .video
                o.numHands = 2
                o.minHandDetectionConfidence = 0.5
                o.minHandPresenceConfidence = 0.5
                o.minTrackingConfidence = 0.5
                self.rec = try GestureRecognizer(options: o)
                self.ready = true
            } catch { self.failed = true }
            self.starting = false
        }
    }

    /// About 6 looks a second (3 when the phone is warm).
    func canSend(_ now: Double) -> Bool {
        if busy && now - sentAt > 4 { busy = false }
        return on && ready && !busy && now - sentAt >= (FaceTracker.hot ? 0.33 : 0.16)
    }

    /// Looks for an open palm. `turn` as in FaceTracker. Answers [score, x, y, w, h] (a box in the
    /// unturned, upright frame, 0..1), or nil for none.
    func detect(_ pb: CVPixelBuffer, turn: Int, _ done: @escaping ([Float]?) -> Void) {
        busy = true
        sentAt = CACurrentMediaTime()
        queue.async {
            var hand: [Float]?
            let img: MPImage? = turn == 0 ? (try? MPImage(pixelBuffer: pb, orientation: .up))
                : FaceTracker.turned(CIImage(cvPixelBuffer: pb), turn).flatMap { try? MPImage(uiImage: $0) }
            if let r = self.rec, let img = img {
                let ts = max(self.lastTs + 1, Int(CACurrentMediaTime() * 1000))
                self.lastTs = ts
                hand = PalmTracker.best(try? r.recognize(videoFrame: img, timestampInMilliseconds: ts), turn)
            }
            self.busy = false
            done(hand)
        }
    }

    /// The surest open palm, with its fingers pointing up (in the upright picture).
    private static func best(_ r: GestureRecognizerResult?, _ turn: Int) -> [Float]? {
        guard let r = r else { return nil }
        var out: [Float]?
        for i in 0..<min(r.gestures.count, r.landmarks.count) {
            guard let g = r.gestures[i].first, g.categoryName == "Open_Palm" else { continue }
            let lm = r.landmarks[i]
            if lm.count < 21 || lm[12].y >= lm[0].y { continue }   // fingers up: middle fingertip above the wrist
            var pts = [Float]()
            for p in lm { pts.append(p.x); pts.append(p.y) }
            guard let u = FaceTracker.unturn(pts, turn), u.allSatisfy({ $0.isFinite }) else { continue }
            var x0: Float = 1, y0: Float = 1, x1: Float = 0, y1: Float = 0
            for k in stride(from: 0, to: u.count, by: 2) { x0 = min(x0, u[k]); y0 = min(y0, u[k + 1]); x1 = max(x1, u[k]); y1 = max(y1, u[k + 1]) }
            if out == nil || g.score > out![0] { out = [g.score, x0, y0, x1 - x0, y1 - y0] }
        }
        return out
    }
}
