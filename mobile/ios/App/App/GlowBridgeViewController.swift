import UIKit
import Capacitor

/// The app's web view, with Glow Studio's own native camera plugin registered (App/GlowCamera).
class GlowBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GlowCameraPlugin())
    }
}
