import Capacitor
import PhotosUI
import Photos
import AVFoundation
import UniformTypeIdentifiers
import ImageIO
import UIKit

private struct FORMMediaError: Error { let code: String }

@objc(FORMMediaPlugin)
public final class FORMMediaPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    public let identifier = "FORMMediaPlugin"
    public let jsName = "FORMMedia"
    public let pluginMethods: [CAPPluginMethod] = ["select", "convert", "save", "share", "discardTransient"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }
    private var pending: CAPPluginCall?
    private var operation = UUID()
    private var progress: Progress?
    private var observation: NSKeyValueObservation?
    private var controller: UIViewController?
    private var temporaryURLs: [URL] = []
    private let importLimit = 10 * 1024 * 1024
    private let exportLimit = 32 * 1024 * 1024

    public override func load() {
        // Recover only this plugin's protected temporary exports after app termination.
        let directory = FileManager.default.temporaryDirectory
        for url in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [] where url.lastPathComponent.hasPrefix("FORM-") {
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func begin(_ call: CAPPluginCall) -> Bool {
        guard pending == nil, let host = bridge?.viewController, host.presentedViewController == nil else {
            call.reject("Another native media action is open.", "NATIVE_MEDIA_BUSY"); return false
        }
        pending = call; operation = UUID(); return true
    }
    private func finish(_ result: JSObject? = nil, code: String? = nil) {
        let call = pending; pending = nil; operation = UUID()
        progress?.cancel(); progress = nil; observation = nil
        controller?.dismiss(animated: true); controller = nil
        for url in temporaryURLs { try? FileManager.default.removeItem(at: url) }
        temporaryURLs.removeAll()
        if let code = code { call?.reject("This media action could not be completed.", code) }
        else { call?.resolve(result ?? ["status": "cancelled"]) }
    }
    @objc public func select(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.begin(call) else { return }
            let id = self.operation
            switch call.getString("source") {
            case "library":
                var config = PHPickerConfiguration(photoLibrary: .shared())
                config.filter = .images; config.selectionLimit = 1
                config.preferredAssetRepresentationMode = .current
                let picker = PHPickerViewController(configuration: config); picker.delegate = self
                self.controller = picker; self.bridge?.viewController?.present(picker, animated: true)
            case "camera":
                guard UIImagePickerController.isSourceTypeAvailable(.camera) else { self.finish(["status": "unavailable"]); return }
                AVCaptureDevice.requestAccess(for: .video) { allowed in
                    DispatchQueue.main.async {
                        guard self.operation == id else { return }
                        guard allowed else { self.finish(["status": "denied"]); return }
                        let picker = UIImagePickerController(); picker.sourceType = .camera; picker.delegate = self
                        picker.mediaTypes = [UTType.image.identifier]; picker.allowsEditing = false
                        self.controller = picker; self.bridge?.viewController?.present(picker, animated: true)
                    }
                }
            default: self.finish(code: "INVALID_NATIVE_MEDIA")
            }
        }
    }
    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        let id = operation
        picker.dismiss(animated: true) {
            guard self.operation == id, self.pending != nil else { return }
            guard let provider = results.first?.itemProvider else { self.finish(); return }
            let alert = UIAlertController(title: "Preparing photo", message: "Downloading or decoding the selected photo.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in self.finish() })
            self.controller = alert; self.bridge?.viewController?.present(alert, animated: true)
            self.notifyListeners("importProgress", data: ["phase": "loading"])
            let download = provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, error in
                var result: JSObject?; var code: String?
                do {
                    guard error == nil, let url = url else { throw FORMMediaError(code: "ICLOUD_READ_FAILED") }
                    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard size > 0, size <= self.exportLimit else { throw FORMMediaError(code: "INPUT_BYTE_LIMIT") }
                    // Item-provider URL is only valid inside this callback. Never upload/cache it.
                    result = try self.normalize(Data(contentsOf: url, options: .mappedIfSafe))
                } catch { code = (error as? FORMMediaError)?.code ?? "ICLOUD_READ_FAILED" }
                DispatchQueue.main.async { if self.operation == id { self.finish(result, code: code) } }
            }
            self.progress = download
            self.observation = download.observe(\.fractionCompleted, options: [.new]) { [weak self] value, _ in
                DispatchQueue.main.async {
                    guard let self = self, self.operation == id, value.totalUnitCount > 0 else { return }
                    self.notifyListeners("importProgress", data: ["phase": "loading", "fraction": max(0, min(1, value.fractionCompleted))])
                }
            }
        }
    }
    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { finish() }
    public func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        guard let image = info[.originalImage] as? UIImage else { finish(code: "INPUT_UNREADABLE"); return }
        let id = operation
        picker.dismiss(animated: true) {
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let result = try self.normalize(image, png: false)
                    DispatchQueue.main.async { if self.operation == id { self.finish(result) } }
                } catch {
                    DispatchQueue.main.async { if self.operation == id { self.finish(code: (error as? FORMMediaError)?.code ?? "INPUT_CONVERSION_FAILED") } }
                }
            }
        }
    }
    private func imageSource(_ data: Data) throws -> (CGImageSource, NSDictionary) {
        guard !data.isEmpty, data.count <= exportLimit,
              let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) == 1,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as NSDictionary?,
              let width = properties[kCGImagePropertyPixelWidth] as? Int, let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, Double(width) * Double(height) <= 40_000_000 else { throw FORMMediaError(code: "INPUT_PIXEL_LIMIT") }
        return (source, properties)
    }
    private func normalize(_ data: Data) throws -> JSObject {
        let (source, _) = try imageSource(data)
        guard let type = CGImageSourceGetType(source) as String?, [UTType.jpeg.identifier, UTType.png.identifier, UTType.heic.identifier, "public.heif"].contains(type),
              let image = UIImage(data: data) else { throw FORMMediaError(code: "INPUT_UNSUPPORTED_FORMAT") }
        return try normalize(image, png: type == UTType.png.identifier)
    }
    private func normalize(_ image: UIImage, png: Bool) throws -> JSObject {
        guard let cgImage = image.cgImage, Double(cgImage.width) * Double(cgImage.height) <= 40_000_000 else { throw FORMMediaError(code: "INPUT_PIXEL_LIMIT") }
        let rotations: [UIImage.Orientation] = [.left, .leftMirrored, .right, .rightMirrored]
        let swap = rotations.contains(image.imageOrientation)
        let size = CGSize(width: CGFloat(swap ? cgImage.height : cgImage.width), height: CGFloat(swap ? cgImage.width : cgImage.height))
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = !png
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
            if !png { UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size)) }
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let data = png ? rendered.pngData() : rendered.jpegData(compressionQuality: 0.92), data.count <= importLimit else { throw FORMMediaError(code: "INPUT_BYTE_LIMIT") }
        return ["status": "selected", "data": data.base64EncodedString(), "mime": png ? "image/png" : "image/jpeg", "width": Int(size.width), "height": Int(size.height), "bytes": data.count, "orientation": 1]
    }
    @objc public func convert(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.begin(call) else { return }; let id = self.operation
            guard let encoded = call.getString("data"), encoded.count <= (self.importLimit + 2) / 3 * 4, let data = Data(base64Encoded: encoded) else { self.finish(code: "INVALID_NATIVE_MEDIA"); return }
            DispatchQueue.global(qos: .userInitiated).async {
                do { let result = try self.normalize(data); DispatchQueue.main.async { if self.operation == id { self.finish(result) } } }
                catch { DispatchQueue.main.async { if self.operation == id { self.finish(code: (error as? FORMMediaError)?.code ?? "INPUT_CONVERSION_FAILED") } } }
            }
        }
    }
    private func exportData(_ call: CAPPluginCall) throws -> Data {
        guard let encoded = call.getString("data"), encoded.count <= (exportLimit + 2) / 3 * 4, let data = Data(base64Encoded: encoded),
              let width = call.getInt("width"), let height = call.getInt("height") else { throw FORMMediaError(code: "INVALID_NATIVE_MEDIA") }
        let (source, properties) = try imageSource(data)
        let type = CGImageSourceGetType(source) as String?
        guard (type == UTType.png.identifier && call.getString("mime") == "image/png" || type == UTType.jpeg.identifier && call.getString("mime") == "image/jpeg"),
              properties[kCGImagePropertyPixelWidth] as? Int == width, properties[kCGImagePropertyPixelHeight] as? Int == height,
              (properties[kCGImagePropertyOrientation] as? Int ?? 1) == 1 else { throw FORMMediaError(code: "INVALID_NATIVE_MEDIA") }
        return data
    }
    @objc public func save(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.begin(call) else { return }; let id = self.operation
            do {
                let data = try self.exportData(call)
                PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                    DispatchQueue.main.async {
                        guard self.operation == id else { return }
                        guard status == .authorized else { self.finish(["status": "denied"]); return }
                        PHPhotoLibrary.shared().performChanges({ PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil) }) { saved, _ in
                            DispatchQueue.main.async { if self.operation == id { self.finish(saved ? ["status": "saved"] : nil, code: saved ? nil : "PHOTO_SAVE_FAILED") } }
                        }
                    }
                }
            } catch { self.finish(code: "INVALID_NATIVE_MEDIA") }
        }
    }
    @objc public func share(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.begin(call) else { return }; let id = self.operation
            do {
                let data = try self.exportData(call), ext = call.getString("mime") == "image/png" ? "png" : "jpg"
                var url = FileManager.default.temporaryDirectory.appendingPathComponent("FORM-\(UUID().uuidString).\(ext)")
                try data.write(to: url, options: .atomic)
                self.temporaryURLs.append(url)
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
                var values = URLResourceValues(); values.isExcludedFromBackup = true; try url.setResourceValues(values)
                let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = self.bridge?.viewController?.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: 0, y: 0, width: 1, height: 1)
                sheet.completionWithItemsHandler = { _, completed, _, error in
                    DispatchQueue.main.async { if self.operation == id { self.finish(["status": completed ? "shared" : "cancelled"], code: error == nil ? nil : "SHARE_FAILED") } }
                }
                self.controller = sheet; self.bridge?.viewController?.present(sheet, animated: true)
                self.notifyListeners("importProgress", data: ["phase": "share_sheet_opened"])
            } catch { self.finish(code: "INVALID_NATIVE_MEDIA") }
        }
    }
    @objc public func discardTransient(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.finish(); call.resolve() }
    }
}
