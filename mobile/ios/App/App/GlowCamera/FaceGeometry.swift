import UIKit

/// The face masks and reshape moves for the beauty shader: a port of drawMasks() and setShape()
/// in public/livebeauty.js (and FaceGeometry.java on Android). Points are MediaPipe's 478-point
/// face mesh as x, y pairs in frame pixels.
final class FaceGeometry {
    static let BROW = 10, CHEEK_L = 234, CHEEK_R = 454, CHIN = 152, NOSE_TIP = 4, NOSE_BASE = 2,
        ALAR_L = 129, ALAR_R = 358, JAW_L = 172, JAW_R = 397, LOW_JAW_L = 136, LOW_JAW_R = 365, APPLE_L = 50, APPLE_R = 280
    static let OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
    static let EYE_L = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
    static let EYE_R = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
    static let BROW_L = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]
    static let BROW_R = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]
    static let LIPS_OUT = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]
    static let LIPS_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191]

    static func dist(_ P: [Float], _ a: Int, _ b: Int) -> Float { hypotf(P[a * 2] - P[b * 2], P[a * 2 + 1] - P[b * 2 + 1]) }

    /// A mask as RGBA bytes, top row first.
    struct Mask { var w = 1, h = 1, bytes = [UInt8](arrayLiteral: 0, 0, 0, 255) }
    var maskA = Mask(), maskB = Mask()
    static let blank = Mask()

    var eyeL: SIMD4<Float> = [0, 0, 1, 0], eyeR: SIMD4<Float> = [0, 0, 1, 0]
    var slim = [SIMD4<Float>](repeating: .zero, count: 4), nose = [SIMD4<Float>](repeating: .zero, count: 2)
    var slimR: SIMD2<Float> = [1, 1]

    private static func mean(_ P: [Float], _ idx: [Int], _ s: CGFloat) -> CGPoint {
        var x: Float = 0, y: Float = 0
        for i in idx { x += P[i * 2]; y += P[i * 2 + 1] }
        return CGPoint(x: CGFloat(x) / CGFloat(idx.count) * s, y: CGFloat(y) / CGFloat(idx.count) * s)
    }
    private static func poly(_ c: CGContext, _ P: [Float], _ idx: [Int], _ s: CGFloat) {
        c.beginPath()
        for (k, i) in idx.enumerated() {
            let p = CGPoint(x: CGFloat(P[i * 2]) * s, y: CGFloat(P[i * 2 + 1]) * s)
            if k == 0 { c.move(to: p) } else { c.addLine(to: p) }
        }
        c.closePath()
    }

    /// Draws into a w×h RGBA bitmap with the origin at the top left (like a canvas).
    private static func paint(_ w: Int, _ h: Int, _ draw: (CGContext) -> Void) -> Mask {
        var m = Mask(w: w, h: h, bytes: [UInt8](repeating: 0, count: w * h * 4))
        m.bytes.withUnsafeMutableBytes { buf in
            guard let c = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
            c.translateBy(x: 0, y: CGFloat(h)); c.scaleBy(x: 1, y: -1)
            c.setFillColor(UIColor.black.cgColor); c.fill(CGRect(x: 0, y: 0, width: w, height: h))
            c.setShouldAntialias(true)
            draw(c)
        }
        return m
    }

    func drawMasks(_ W: Int, _ H: Int, _ P: [Float]) {
        let red = UIColor(red: 1, green: 0, blue: 0, alpha: 1).cgColor, black = UIColor.black.cgColor
        var s = CGFloat(min(1, 96 / Float(max(W, H))))
        let wa = max(1, Int((CGFloat(W) * s).rounded())), ha = max(1, Int((CGFloat(H) * s).rounded()))
        let sa = s
        maskA = FaceGeometry.paint(wa, ha) { c in
            let faceW = CGFloat(FaceGeometry.dist(P, FaceGeometry.CHEEK_L, FaceGeometry.CHEEK_R)) * sa
            let faceC = FaceGeometry.mean(P, FaceGeometry.OVAL, sa)
            // Skin: the face without eyes, brows, lips and nostrils.
            c.setFillColor(red); FaceGeometry.poly(c, P, FaceGeometry.OVAL, sa); c.fillPath()
            c.setFillColor(black); c.setStrokeColor(black)
            for e in [FaceGeometry.EYE_L, FaceGeometry.EYE_R] {
                let ce = FaceGeometry.mean(P, e, sa), ew = CGFloat(FaceGeometry.dist(P, e[0], e[8])) * sa
                let ang = atan2(CGFloat(P[e[8] * 2 + 1] - P[e[0] * 2 + 1]), CGFloat(P[e[8] * 2] - P[e[0] * 2]))
                c.saveGState(); c.translateBy(x: ce.x, y: ce.y); c.rotate(by: ang)
                c.fillEllipse(in: CGRect(x: -ew * 0.75, y: -ew * 0.45, width: ew * 1.5, height: ew * 0.9))
                c.restoreGState()
            }
            c.setLineWidth(faceW / 22); c.setLineJoin(.round)
            for br in [FaceGeometry.BROW_L, FaceGeometry.BROW_R] { FaceGeometry.poly(c, P, br, sa); c.drawPath(using: .fillStroke) }
            FaceGeometry.poly(c, P, FaceGeometry.LIPS_OUT, sa); c.fillPath()
            let nb = CGPoint(x: CGFloat(P[FaceGeometry.NOSE_BASE * 2]) * sa, y: CGFloat(P[FaceGeometry.NOSE_BASE * 2 + 1]) * sa - faceW * 0.02)
            c.fillEllipse(in: CGRect(x: nb.x - faceW * 0.09, y: nb.y - faceW * 0.05, width: faceW * 0.18, height: faceW * 0.1))
            // Blush: a soft round wash on the apple of each cheek.
            c.setBlendMode(.plusLighter)
            let space = CGColorSpaceCreateDeviceRGB()
            let cols = [UIColor(red: 0, green: 0, blue: 1, alpha: 0.9).cgColor, UIColor(red: 0, green: 0, blue: 1, alpha: 0.5).cgColor, UIColor(red: 0, green: 0, blue: 1, alpha: 0).cgColor] as CFArray
            if let g = CGGradient(colorsSpace: space, colors: cols, locations: [0, 0.5, 1]) {
                for i in [FaceGeometry.APPLE_L, FaceGeometry.APPLE_R] {
                    let ctr = CGPoint(x: (CGFloat(P[i * 2]) * sa * 2 + faceC.x) / 3, y: CGFloat(P[i * 2 + 1]) * sa - faceW * 0.02), r = faceW * 0.2
                    if r > 0.5 { c.drawRadialGradient(g, startCenter: ctr, startRadius: 0, endCenter: ctr, endRadius: r, options: []) }
                }
            }
        }
        s = CGFloat(min(1, 320 / Float(max(W, H))))
        let sb = s
        maskB = FaceGeometry.paint(max(1, Int((CGFloat(W) * s).rounded())), max(1, Int((CGFloat(H) * s).rounded()))) { c in
            c.setFillColor(red)
            for br in [FaceGeometry.BROW_L, FaceGeometry.BROW_R] { FaceGeometry.poly(c, P, br, sb); c.fillPath() }
            // Lips: the outer lip line minus the open mouth.
            c.setBlendMode(.plusLighter); c.setFillColor(UIColor(red: 0, green: 1, blue: 0, alpha: 1).cgColor)
            FaceGeometry.poly(c, P, FaceGeometry.LIPS_OUT, sb); c.fillPath()
            c.setBlendMode(.normal); c.setFillColor(black)
            FaceGeometry.poly(c, P, FaceGeometry.LIPS_IN, sb); c.fillPath()
        }
    }

    /// The reshape moves, kept as gentle as the still-photo tools. Amounts are 0..1 (already faded).
    func shape(_ P: [Float], eyes: Float, slimAmt: Float, noseAmt: Float) {
        let faceW = FaceGeometry.dist(P, FaceGeometry.CHEEK_L, FaceGeometry.CHEEK_R)
        for (k, e) in [FaceGeometry.EYE_L, FaceGeometry.EYE_R].enumerated() {
            let c = FaceGeometry.mean(P, e, 1), ew = FaceGeometry.dist(P, e[0], e[8])
            let v = SIMD4<Float>(Float(c.x), Float(c.y), ew * 1.25, eyes * 0.2)
            if k == 0 { eyeL = v } else { eyeR = v }
        }
        let tx = P[FaceGeometry.BROW * 2], ty = P[FaceGeometry.BROW * 2 + 1], cx = P[FaceGeometry.CHIN * 2], cy = P[FaceGeometry.CHIN * 2 + 1]
        var al = hypotf(cx - tx, cy - ty); if al == 0 { al = 1 }
        let ax = (cx - tx) / al, ay = (cy - ty) / al
        for (k, i) in [FaceGeometry.JAW_L, FaceGeometry.JAW_R, FaceGeometry.LOW_JAW_L, FaceGeometry.LOW_JAW_R].enumerated() {
            let px = P[i * 2], py = P[i * 2 + 1], t = (px - tx) * ax + (py - ty) * ay
            let dx = tx + ax * t - px, dy = ty + ay * t - py
            var l = hypotf(dx, dy); if l == 0 { l = 1 }
            let m = faceW * 0.05 * slimAmt
            slim[k] = [px, py, dx / l * m, dy / l * m]
        }
        let nx = P[FaceGeometry.NOSE_TIP * 2], ny = P[FaceGeometry.NOSE_TIP * 2 + 1], noseW = FaceGeometry.dist(P, FaceGeometry.ALAR_L, FaceGeometry.ALAR_R)
        for (k, i) in [FaceGeometry.ALAR_L, FaceGeometry.ALAR_R].enumerated() {
            let px = P[i * 2], py = P[i * 2 + 1], dx = nx - px, dy = ny - py
            var l = hypotf(dx, dy); if l == 0 { l = 1 }
            let m = noseW * 0.12 * noseAmt
            nose[k] = [px, py, dx / l * m, dy / l * m]
        }
        slimR = [faceW * 0.36, noseW * 0.8]
    }

    func clearShape() {
        eyeL = [0, 0, 1, 0]; eyeR = [0, 0, 1, 0]
        slim = [SIMD4<Float>](repeating: .zero, count: 4); nose = [SIMD4<Float>](repeating: .zero, count: 2)
        slimR = [1, 1]
    }
}
