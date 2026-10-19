import ExpoModulesCore
import UIKit

/// The iPhone Duo fold, as the division reserved region of the key window's root view.
/// `UIViewReservedRegion` exists from iOS 27.1; earlier systems have none, so every
/// call reports "no region" there instead of failing.
public class FoldRegionModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("FoldRegion")

    Events("onChange")

    Function("getDivisionRegion") { () -> [String: Any]? in
      return Self.divisionRegion()
    }

    OnStartObserving {
      self.observer = NotificationCenter.default.addObserver(
        forName: UIApplication.didBecomeActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.sendEvent("onChange", ["region": Self.divisionRegion() as Any])
      }
      DispatchQueue.main.async { self.watchTraits() }
    }

    OnStopObserving {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      self.observer = nil
    }
  }

  /// Pose changes reach an app as trait and geometry changes, so the window's traits are
  /// watched and the region is re-read on each.
  private func watchTraits() {
    guard #available(iOS 17.0, *), let window = Self.keyWindow() else { return }
    window.registerForTraitChanges(
      [UITraitHorizontalSizeClass.self, UITraitVerticalSizeClass.self, UITraitUserInterfaceIdiom.self]
    ) { [weak self] (_: UIWindow, _) in
      self?.sendEvent("onChange", ["region": Self.divisionRegion() as Any])
    }
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }

  private static func divisionRegion() -> [String: Any]? {
    guard #available(iOS 27.1, *) else { return nil }
    var result: [String: Any]?
    let read = {
      guard let root = keyWindow()?.rootViewController?.view else { return }
      guard let region = root.reservedRegions(kind: .division).first(where: { $0.isActive }) else {
        return
      }
      result = [
        "x": region.frame.origin.x,
        "y": region.frame.origin.y,
        "width": region.frame.size.width,
        "height": region.frame.size.height,
      ]
    }
    if Thread.isMainThread { read() } else { DispatchQueue.main.sync(execute: read) }
    return result
  }
}
