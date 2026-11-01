import Foundation
import UIKit
import Vision
import Capacitor

/// The phone's own cutout for the editor's Person / Background areas: Apple's person segmentation
/// (Vision, "accurate"), on the phone and free. It finds every person at once, so it comes back as
/// one subject covering the whole picture.
///
/// people({ image: "data:image/jpeg;base64,..." }) resolves to
///   { engine: "vision", width, height, subjects: [{ x: 0, y: 0, w: 1, h: 1, mw, mh, mask }] }
/// mask is base64 of mw*mh bytes (0-255 confidence).
@objc(GlowCutoutPlugin)
public class GlowCutoutPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GlowCutoutPlugin"
    public let jsName = "GlowCutout"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "people", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "glow.cutout", qos: .userInitiated)

    @objc func people(_ call: CAPPluginCall) {
        guard let data = call.getString("image") else { call.reject("No image"); return }
        let b64 = data.range(of: ",").map { String(data[$0.upperBound...]) } ?? data
        guard let bytes = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: bytes), let cg = image.cgImage else { call.reject("Bad image"); return }
        queue.async {
            guard #available(iOS 15.0, *) else { call.reject("Needs iOS 15"); return }
            let request = VNGeneratePersonSegmentationRequest()
            request.qualityLevel = .accurate
            request.outputPixelFormat = kCVPixelFormatType_OneComponent8
            do {
                try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
            } catch {
                call.reject(error.localizedDescription); return
            }
            guard let buffer = request.results?.first?.pixelBuffer else { call.reject("No person found"); return }
            CVPixelBufferLockBaseAddress(buffer, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
            let mw = CVPixelBufferGetWidth(buffer), mh = CVPixelBufferGetHeight(buffer), stride = CVPixelBufferGetBytesPerRow(buffer)
            guard let base = CVPixelBufferGetBaseAddress(buffer) else { call.reject("No mask"); return }
            var mask = Data(count: mw * mh)
            mask.withUnsafeMutableBytes { (out: UnsafeMutableRawBufferPointer) in
                for y in 0..<mh { memcpy(out.baseAddress! + y * mw, base + y * stride, mw) }
            }
            call.resolve([
                "engine": "vision", "width": cg.width, "height": cg.height,
                "subjects": [["x": 0, "y": 0, "w": 1, "h": 1, "mw": mw, "mh": mh, "mask": mask.base64EncodedString()]]
            ])
        }
    }
}
