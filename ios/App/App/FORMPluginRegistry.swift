import Capacitor

// One source of native registration; later task plugins remain isolated until F32.
enum FORMPluginRegistry {
    static func register(on bridge: CAPBridgeProtocol) {
        bridge.registerPluginInstance(FORMMediaPlugin())
        bridge.registerPluginInstance(FORMAuthPlugin())
        bridge.registerPluginInstance(FORMPurchasePlugin())
    }
}

@objc(FORMBridgeViewController)
final class FORMBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        guard let bridge = bridge else { return }
        FORMPluginRegistry.register(on: bridge)
    }
}
