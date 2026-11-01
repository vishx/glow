import Foundation
import Metal
import MetalKit
import CoreVideo
import UIKit

/// Draws the camera with the live look in Metal: the same shader as public/livebeauty.js and the
/// Android camera (face reshape, skin smoothing on the face only, lips, blush and brows, brightness
/// and warmth), plus the photo filter as a color matrix. Frames arrive upright and not mirrored;
/// the front camera is mirrored only when drawn, so photo and preview match.
final class BeautyRenderer: NSObject, MTKViewDelegate {
    static let source = """
    #include <metal_stdlib>
    using namespace metal;
    struct VOut { float4 pos [[position]]; float2 uv; };
    // u[0] crop; u[1] mirror, -, tapScale, plain; u[2] size.xy, slimR.xy; u[3] mpxA.xy, mpxB.xy;
    // u[4] smooth, bright, warm, faceOn; u[5] eyeL; u[6] eyeR; u[7..10] slim; u[11..12] nose;
    // u[13] lips; u[14] blush; u[15] brows; u[16..27] 4 color matrices (3 rows each); u[28] wash
    struct U { float4 u[29]; };

    vertex VOut vmain(uint vid [[vertex_id]], constant U& k [[buffer(0)]]) {
      float2 p = float2((vid & 1) ? 1.0 : -1.0, (vid & 2) ? 1.0 : -1.0);
      float2 s = float2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
      if (k.u[1].x > 0.5) s.x = 1.0 - s.x;
      VOut o; o.pos = float4(p, 0.0, 1.0); o.uv = k.u[0].xy + s * k.u[0].zw; return o;
    }
    float2 shift(float2 p, float4 cm, float r) {
      float2 d = p - cm.xy; float t = dot(d, d) / (r * r);
      if (t >= 1.0) return p;
      float f = 1.0 - t;
      return p - f * f * cm.zw;
    }
    float2 zoom(float2 p, float4 e) {
      float2 d = p - e.xy; float t = length(d) / e.z;
      if (t >= 1.0 || e.w <= 0.0) return p;
      float f = 1.0 - t * t;
      return e.xy + d * (1.0 - e.w * f * f);
    }
    float4 soft(texture2d<float> m, sampler sm, float2 q, float2 mpx) {
      float4 s = float4(0.0);
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) s += m.sample(sm, q + float2(float(x), float(y)) * mpx * 1.3);
      return s / 9.0;
    }
    float lum(float3 c) { return dot(c, float3(0.299, 0.587, 0.114)); }
    float3 softLight(float3 a, float3 b) {
      return mix(2.0 * a * b + a * a * (1.0 - 2.0 * b), sqrt(a) * (2.0 * b - 1.0) + 2.0 * a * (1.0 - b), step(0.5, b));
    }
    fragment float4 fmain(VOut in [[stage_in]], constant U& k [[buffer(0)]],
                          texture2d<float> tex [[texture(0)]], texture2d<float> mA [[texture(1)]], texture2d<float> mB [[texture(2)]]) {
      constexpr sampler sm(filter::linear, address::clamp_to_edge);
      float2 uv = in.uv;
      if (k.u[1].w > 0.5) return float4(tex.sample(sm, uv).rgb, 1.0);
      float2 size = k.u[2].xy, slimR = k.u[2].zw;
      float faceOn = k.u[4].w;
      float2 p = uv * size;
      if (faceOn > 0.5) {
        for (int i = 0; i < 4; i++) p = shift(p, k.u[7 + i], slimR.x);
        for (int i = 0; i < 2; i++) p = shift(p, k.u[11 + i], slimR.y);
        p = zoom(zoom(p, k.u[5]), k.u[6]);
      }
      float2 q = p / size, px = k.u[1].z / size;
      float3 c = tex.sample(sm, q).rgb, sum = c; float wsum = 1.0;
      for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) {
        if (x == 0 && y == 0) continue;
        float3 s = tex.sample(sm, q + float2(float(x), float(y)) * px * 2.0).rgb;
        float d = distance(s, c);
        float w = exp(-d * d * 60.0) * exp(-float(x * x + y * y) / 18.0);
        sum += s * w; wsum += w;
      }
      float4 a = faceOn > 0.5 ? soft(mA, sm, q, k.u[3].xy) : float4(1.0, 0.0, 0.0, 0.0);
      float3 col = mix(c, sum / wsum, k.u[4].x * a.r);
      if (faceOn > 0.5) {
        float4 lips = k.u[13], blush = k.u[14], brows = k.u[15];
        float4 b = soft(mB, sm, q, k.u[3].zw);
        float bm = b.r * brows.a;
        col = mix(col, mix(col * brows.rgb * 1.25, brows.rgb, 0.25), bm);
        float cm = a.b * blush.a;
        col = mix(col, softLight(col, blush.rgb), cm);
        col = mix(col, col * blush.rgb, cm * 0.25);
        float lm = b.g * lips.a;
        float3 tint = lips.rgb * ((lum(col) * 0.45 + lum(lips.rgb) * 0.55) / max(lum(lips.rgb), 0.05));
        col = mix(col, clamp(tint, 0.0, 1.0), lm);
      }
      col = pow(max(col, 0.0), float3(1.0 - k.u[4].y * 0.35));
      col += float3(0.06, 0.025, -0.03) * k.u[4].z;
      col = clamp(col, 0.0, 1.0);
      for (int i = 0; i < 4; i++) {
        float4 r0 = k.u[16 + i * 3], r1 = k.u[17 + i * 3], r2 = k.u[18 + i * 3];
        col = clamp(float3(dot(r0.xyz, col) + r0.w, dot(r1.xyz, col) + r1.w, dot(r2.xyz, col) + r2.w), 0.0, 1.0);
      }
      col = mix(col, softLight(col, k.u[28].rgb), k.u[28].a);
      return float4(clamp(col, 0.0, 1.0), 1.0);
    }
    """

    let device: MTLDevice
    private let queue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private let pipelineOffscreen: MTLRenderPipelineState
    private var cache: CVMetalTextureCache?
    private let geo = FaceGeometry()
    private let tracker: FaceTracker
    weak var host: GlowCameraPlugin?
    private var shown: Float = 0

    init?(tracker: FaceTracker) {
        guard let d = MTLCreateSystemDefaultDevice(), let q = d.makeCommandQueue() else { return nil }
        device = d; queue = q; self.tracker = tracker
        do {
            let lib = try d.makeLibrary(source: BeautyRenderer.source, options: nil)
            let desc = MTLRenderPipelineDescriptor()
            desc.vertexFunction = lib.makeFunction(name: "vmain")
            desc.fragmentFunction = lib.makeFunction(name: "fmain")
            desc.colorAttachments[0].pixelFormat = .bgra8Unorm
            pipeline = try d.makeRenderPipelineState(descriptor: desc)
            desc.colorAttachments[0].pixelFormat = .rgba8Unorm
            pipelineOffscreen = try d.makeRenderPipelineState(descriptor: desc)
        } catch {
            NSLog("GlowCamera shader: \(error)")
            return nil
        }
        super.init()
        CVMetalTextureCacheCreate(nil, nil, d, nil, &cache)
    }

    // Mask textures are reused: three per mask in turn, so the one being filled isn't one the GPU may
    // still be reading for an earlier frame; the blank mask (no face) is made once.
    private var ring: [[MTLTexture]] = [[], []]
    private var ringAt = 0
    private var blankTex: MTLTexture?

    private func makeTexture(_ w: Int, _ h: Int) -> MTLTexture? {
        let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: w, height: h, mipmapped: false)
        d.usage = .shaderRead
        return device.makeTexture(descriptor: d)
    }

    private func texture(_ m: FaceGeometry.Mask, slot: Int) -> MTLTexture? {
        let isBlank = m.w == FaceGeometry.blank.w && m.h == FaceGeometry.blank.h && m.bytes == FaceGeometry.blank.bytes
        if isBlank, let t = blankTex { return t }
        var t: MTLTexture?
        if isBlank { t = makeTexture(m.w, m.h); blankTex = t }
        else {
            if ring[slot].count < 3 { if let n = makeTexture(m.w, m.h) { ring[slot].append(n) } }
            let i = ringAt % max(1, ring[slot].count)
            if i < ring[slot].count, ring[slot][i].width != m.w || ring[slot][i].height != m.h { if let n = makeTexture(m.w, m.h) { ring[slot][i] = n } }
            t = i < ring[slot].count ? ring[slot][i] : nil
        }
        guard let tex = t else { return nil }
        m.bytes.withUnsafeBytes { tex.replace(region: MTLRegionMake2D(0, 0, m.w, m.h), mipmapLevel: 0, withBytes: $0.baseAddress!, bytesPerRow: m.w * 4) }
        return tex
    }

    func cameraTexture(_ pb: CVPixelBuffer) -> MTLTexture? {
        guard let cache = cache else { return nil }
        var cv: CVMetalTexture?
        CVMetalTextureCacheCreateTextureFromImage(nil, cache, pb, nil, .bgra8Unorm, CVPixelBufferGetWidth(pb), CVPixelBufferGetHeight(pb), 0, &cv)
        return cv.flatMap { CVMetalTextureGetTexture($0) }
    }

    /// Everything the shader needs for one draw.
    private func uniforms(W: Int, H: Int, crop: SIMD4<Float>, mirror: Bool, look: Look, plain: Bool, faceOn: Bool,
                          P: [Float]?, k: Float) -> ([SIMD4<Float>], FaceGeometry.Mask, FaceGeometry.Mask) {
        var a = FaceGeometry.blank, b = FaceGeometry.blank
        if faceOn, let P = P {
            geo.drawMasks(W, H, P); a = geo.maskA; b = geo.maskB
            geo.shape(P, eyes: look.eyes * k, slimAmt: look.slim * k, noseAmt: look.nose * k)
        } else { geo.clearShape() }
        let kk: Float = P != nil ? k : 0
        func shade(_ rgb: SIMD3<Float>, _ amt: Float, _ base: Float, _ span: Float) -> SIMD4<Float> { [rgb.x, rgb.y, rgb.z, amt > 0 ? base + span * amt : 0] }
        let c = look.color, w = look.wash
        var u = [SIMD4<Float>](repeating: .zero, count: 29)
        u[0] = crop
        u[1] = [mirror ? 1 : 0, 0, max(1, Float(max(W, H)) / 1280), plain ? 1 : 0]
        u[2] = [Float(W), Float(H), geo.slimR.x, geo.slimR.y]
        u[3] = [1 / Float(a.w), 1 / Float(a.h), 1 / Float(b.w), 1 / Float(b.h)]
        u[4] = [look.smooth, look.bright, look.warm, faceOn ? 1 : 0]
        u[5] = geo.eyeL; u[6] = geo.eyeR
        for i in 0..<4 { u[7 + i] = geo.slim[i] }
        for i in 0..<2 { u[11 + i] = geo.nose[i] }
        u[13] = shade(look.lipShade, look.lips * kk, 0.15, 0.45)
        u[14] = shade(look.blushShade, look.blush * kk, 0.1, 0.35)
        u[15] = shade(look.browShade, look.brows * kk, 0.1, 0.4)
        for i in 0..<12 { u[16 + i] = [c[i * 4], c[i * 4 + 1], c[i * 4 + 2], c[i * 4 + 3]] }
        u[28] = [w[0], w[1], w[2], w[3]]
        return (u, a, b)
    }

    private func encode(_ enc: MTLRenderCommandEncoder, _ u: [SIMD4<Float>], _ tex: MTLTexture, _ a: FaceGeometry.Mask, _ b: FaceGeometry.Mask) {
        var u = u
        enc.setVertexBytes(&u, length: MemoryLayout<SIMD4<Float>>.stride * u.count, index: 0)
        enc.setFragmentBytes(&u, length: MemoryLayout<SIMD4<Float>>.stride * u.count, index: 0)
        enc.setFragmentTexture(tex, index: 0)
        ringAt += 1
        enc.setFragmentTexture(texture(a, slot: 0), index: 1)
        enc.setFragmentTexture(texture(b, slot: 1), index: 2)
        enc.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let host = host, let rpd = view.currentRenderPassDescriptor, let drawable = view.currentDrawable,
              let cmd = queue.makeCommandBuffer() else { return }
        rpd.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        rpd.colorAttachments[0].loadAction = .clear
        guard let enc = cmd.makeRenderCommandEncoder(descriptor: rpd) else { return }
        if let pb = host.latestFrame(), let tex = cameraTexture(pb) {
            let W = CVPixelBufferGetWidth(pb), H = CVPixelBufferGetHeight(pb)
            let look = host.look
            // The preview fills the viewfinder's box (cropped, not shrunk), like object-fit: cover.
            let r = host.viewRect(look.view, drawable: view.drawableSize)
            enc.setViewport(MTLViewport(originX: Double(r.minX), originY: Double(r.minY), width: Double(max(1, r.width)), height: Double(max(1, r.height)), znear: 0, zfar: 1))
            let k = max(Float(r.width) / Float(W), Float(r.height) / Float(H))
            let cw = min(1, Float(r.width) / k / Float(W)), ch = min(1, Float(r.height) / k / Float(H))
            let crop = SIMD4<Float>((1 - cw) / 2, (1 - ch) * look.posY, cw, ch)
            let s = tracker.snap()
            let fits = s.pts != nil && s.W == W && s.H == H
            let want: Float = fits && s.seen > 0 && tracker.ready ? 1 : 0
            shown += (want - shown) * 0.3
            if abs(want - shown) < 0.02 { shown = want }
            if want == 0 && shown == 0 { tracker.forgetIfGone() }
            let P = fits && shown > 0 ? s.pts : nil
            let (u, a, b) = uniforms(W: W, H: H, crop: crop, mirror: host.mirror, look: look, plain: look.compare,
                                     faceOn: !tracker.failed, P: P, k: P != nil ? shown : 0)
            enc.setRenderPipelineState(pipeline)
            encode(enc, u, tex, a, b)
        }
        enc.endEncoding()
        cmd.present(drawable)
        cmd.commit()
    }

    /// Draws a still photo (upright, not mirrored) with the look at full size, offscreen; mirrored for the front camera.
    func renderStill(_ img: CGImage, P: [Float]?, look: Look, mirror: Bool) -> CGImage? {
        let W = img.width, H = img.height
        guard let src = try? MTKTextureLoader(device: device).newTexture(cgImage: img, options: [.SRGB: false, .textureUsage: MTLTextureUsage.shaderRead.rawValue]) else { return nil }
        let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: W, height: H, mipmapped: false)
        d.usage = [.renderTarget, .shaderRead]
        d.storageMode = .shared
        guard let out = device.makeTexture(descriptor: d), let cmd = queue.makeCommandBuffer() else { return nil }
        let rpd = MTLRenderPassDescriptor()
        rpd.colorAttachments[0].texture = out
        rpd.colorAttachments[0].loadAction = .clear
        rpd.colorAttachments[0].storeAction = .store
        guard let enc = cmd.makeRenderCommandEncoder(descriptor: rpd) else { return nil }
        var still = look; still.compare = false
        let (u, a, b) = uniforms(W: W, H: H, crop: [0, 0, 1, 1], mirror: mirror, look: still, plain: false,
                                 faceOn: !tracker.failed, P: P, k: P != nil ? 1 : 0)
        enc.setRenderPipelineState(pipelineOffscreen)
        encode(enc, u, src, a, b)
        enc.endEncoding()
        cmd.commit()
        cmd.waitUntilCompleted()
        var bytes = [UInt8](repeating: 0, count: W * H * 4)
        bytes.withUnsafeMutableBytes { out.getBytes($0.baseAddress!, bytesPerRow: W * 4, from: MTLRegionMake2D(0, 0, W, H), mipmapLevel: 0) }
        guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
        return CGImage(width: W, height: H, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: W * 4, space: CGColorSpaceCreateDeviceRGB(),
                       bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    }
}
