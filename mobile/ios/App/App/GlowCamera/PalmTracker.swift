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
                // Image mode: each look finds the hand afresh; looks take turns between the whole
                // picture and crops of it, which video mode's tracking doesn't expect.
                o.runningMode = .image
                o.numHands = 2
                o.minHandDetectionConfidence = 0.5
                o.minHandPresenceConfidence = 0.5
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

    private static let ci = CIContext(options: [.useSoftwareRenderer: false])

    /// Looks for an open palm in `region` ([x, y, w, h] of the upright frame, 0..1; nil = all of it),
    /// cut from the full-size frame so a far hand keeps its detail. `turn` as in FaceTracker.
    /// Answers [score, x, y, w, h] (a box in the whole upright frame, 0..1), or nil for none.
    func detect(_ pb: CVPixelBuffer, turn: Int, region: [Float]?, _ done: @escaping ([Float]?) -> Void) {
        busy = true
        sentAt = CACurrentMediaTime()
        queue.async {
            var hand: [Float]?
            let full = CIImage(cvPixelBuffer: pb)
            let W = full.extent.width, H = full.extent.height
            var im = full
            var r: [Float]? = nil
            if let g = region, g.count == 4, !(g[0] <= 0 && g[1] <= 0 && g[2] >= 1 && g[3] >= 1) {
                // Core Image's y axis points up.
                let rect = CGRect(x: CGFloat(g[0]) * W, y: H - CGFloat(g[1] + g[3]) * H, width: CGFloat(g[2]) * W, height: CGFloat(g[3]) * H).integral
                if rect.width >= 16 && rect.height >= 16 {
                    im = full.cropped(to: rect)
                    im = im.transformed(by: CGAffineTransform(translationX: -rect.origin.x, y: -rect.origin.y))
                    r = g
                }
            }
            // At most 480 px on the long side (the model looks at 192 px itself).
            let k = min(1, 480 / max(im.extent.width, im.extent.height))
            if k < 1 { im = im.transformed(by: CGAffineTransform(scaleX: k, y: k)) }
            let ui: UIImage? = turn == 0
                ? PalmTracker.ci.createCGImage(im, from: im.extent).map { UIImage(cgImage: $0) }
                : FaceTracker.turned(im, turn)
            if let rec = self.rec, let u = ui, let img = try? MPImage(uiImage: u) {
                hand = PalmTracker.best(try? rec.recognize(image: img), turn)
                if let h = hand, let g = r { hand = [h[0], g[0] + h[1] * g[2], g[1] + h[2] * g[3], h[3] * g[2], h[4] * g[3]] }
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
