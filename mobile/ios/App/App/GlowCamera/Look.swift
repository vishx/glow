import UIKit

/// The look the camera draws, as sent by the web app (public/livebeauty.js nativeCamState()).
struct Look {
    var smooth: Float = 0, bright: Float = 0, warm: Float = 0, eyes: Float = 0, slim: Float = 0, nose: Float = 0
    var lips: Float = 0, blush: Float = 0, brows: Float = 0
    var lipShade = Look.rgb("#d4787d"), blushShade = Look.rgb("#f4a28c"), browShade = Look.rgb("#5a4030")
    /// The photo filter: color matrix rows (r, g, b weights + offset) and a soft-light wash.
    var color: [Float] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
    var wash: [Float] = [0, 0, 0, 0]
    var compare = false
    var posY: Float = 0.5
    /// The viewfinder's box in the page: x, y, width, height as fractions.
    var view: [Float] = [0, 0, 1, 1]

    var needsFace: Bool { smooth > 0 || eyes > 0 || slim > 0 || nose > 0 || lips > 0 || blush > 0 || brows > 0 }

    static func rgb(_ hex: String) -> SIMD3<Float> {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return [0.8, 0.5, 0.5] }
        return [Float((v >> 16) & 255) / 255, Float((v >> 8) & 255) / 255, Float(v & 255) / 255]
    }

    private static func num(_ v: Any?) -> Float? {
        if let n = v as? NSNumber { let f = n.floatValue; return f.isFinite ? f : nil }
        return nil
    }
    private static func floats(_ v: Any?, _ fallback: [Float]) -> [Float] {
        guard let a = v as? [Any], a.count == fallback.count else { return fallback }
        return a.enumerated().map { num($0.element) ?? fallback[$0.offset] }
    }

    static func from(_ o: [AnyHashable: Any]?) -> Look {
        var l = Look()
        guard let o = o else { return l }
        if let b = o["look"] as? [AnyHashable: Any] {
            let pct = { (k: String) -> Float in max(0, min(100, num(b[k]) ?? 0)) / 100 }
            l.smooth = pct("smooth"); l.bright = pct("bright"); l.warm = pct("warm")
            l.eyes = pct("eyes"); l.slim = pct("slim"); l.nose = pct("nose")
            l.lips = pct("lips"); l.blush = pct("blush"); l.brows = pct("brows")
            if let h = b["lipShade"] as? String { l.lipShade = rgb(h) }
            if let h = b["blushShade"] as? String { l.blushShade = rgb(h) }
            if let h = b["browShade"] as? String { l.browShade = rgb(h) }
        }
        l.color = floats(o["color"], l.color)
        l.wash = floats(o["wash"], l.wash)
        l.view = floats(o["view"], l.view)
        l.compare = (o["compare"] as? Bool) ?? false
        l.posY = max(0, min(1, num(o["posY"]) ?? 0.5))
        return l
    }
}
