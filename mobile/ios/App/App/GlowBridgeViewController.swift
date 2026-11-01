import UIKit
import Capacitor

/// The app's web view, with Glow Studio's own native plugins registered.
class GlowBridgeViewController: CAPBridgeViewController {
    /// True while the camera is open: the camera screen stays upright like the iPhone's own camera
    /// (only its icons turn), so a sideways phone never shows a sideways, stretched picture.
    static var portraitOnly = false

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        GlowBridgeViewController.portraitOnly ? .portrait : super.supportedInterfaceOrientations
    }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GlowCutoutPlugin())
        bridge?.registerPluginInstance(GlowCameraPlugin())
    }
}
