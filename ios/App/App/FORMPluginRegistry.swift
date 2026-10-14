import Capacitor

// One source of native registration; later task plugins remain isolated until F32.
enum FORMPluginRegistry {
    static func register(on bridge: CAPBridgeProtocol) {
        // F19/F21/F24 add local plugin instances here.
    }
}

@objc(FORMBridgeViewController)
final class FORMBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        guard let bridge = bridge else { return }
        FORMPluginRegistry.register(on: bridge)
    }
}
