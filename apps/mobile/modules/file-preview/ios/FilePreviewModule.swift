import ExpoModulesCore
import QuickLook

/// #935, H16: shows a downloaded private file (a CV, a project PDF) in the
/// system Quick Look viewer, which brings paging, zoom, search and Share,
/// instead of bundling a PDF renderer. Resolves once the viewer is closed.
public class FilePreviewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FilePreview")

    AsyncFunction("preview") { (url: URL, title: String, promise: Promise) in
      guard url.isFileURL, let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("ERR_FILE_PREVIEW", "A local file and a visible screen are required")
        return
      }
      let source = PreviewSource(item: PreviewItem(url: url, title: title)) { promise.resolve(nil) }
      let controller = QLPreviewController()
      controller.dataSource = source
      controller.delegate = source
      // The controller only keeps weak references to its data source.
      objc_setAssociatedObject(controller, &PreviewSource.key, source, .OBJC_ASSOCIATION_RETAIN)
      presenter.present(controller, animated: true)
    }.runOnQueue(.main)
  }
}

/// Quick Look titles the file with this, not the cache file's name.
private final class PreviewItem: NSObject, QLPreviewItem {
  let previewItemURL: URL?
  let previewItemTitle: String?

  init(url: URL, title: String) {
    previewItemURL = url
    previewItemTitle = title
  }
}

private final class PreviewSource: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
  static var key = 0
  private let item: PreviewItem
  private var onClose: (() -> Void)?

  init(item: PreviewItem, onClose: @escaping () -> Void) {
    self.item = item
    self.onClose = onClose
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    item
  }

  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    onClose?()
    onClose = nil
  }
}
