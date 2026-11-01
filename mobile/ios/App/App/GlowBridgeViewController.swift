import UIKit
import Capacitor

/// The app's web view, with Glow Studio's own native plugins registered.
class GlowBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GlowCutoutPlugin())
        bridge?.registerPluginInstance(GlowCameraPlugin())
    }
}
