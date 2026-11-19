import ExpoModulesCore
import QuickLook

/// #935, H16: shows a downloaded private file (a CV, a project PDF) in the
/// system Quick Look viewer, which brings paging, zoom, search and Share,
/// instead of bundling a PDF renderer. Resolves once the viewer is closed.
public class FilePreviewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FilePreview")

    AsyncFunction("preview") { (url: URL, promise: Promise) in
      guard url.isFileURL, let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("ERR_FILE_PREVIEW", "A local file and a visible screen are required")
        return
      }
      let source = PreviewSource(url: url) { promise.resolve(nil) }
      let controller = QLPreviewController()
      controller.dataSource = source
      controller.delegate = source
      // The controller only keeps weak references to its data source.
      objc_setAssociatedObject(controller, &PreviewSource.key, source, .OBJC_ASSOCIATION_RETAIN)
      presenter.present(controller, animated: true)
    }.runOnQueue(.main)
  }
}

private final class PreviewSource: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
  static var key = 0
  private let url: URL
  private var onClose: (() -> Void)?

  init(url: URL, onClose: @escaping () -> Void) {
    self.url = url
    self.onClose = onClose
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    url as NSURL
  }

  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    onClose?()
    onClose = nil
  }
}
