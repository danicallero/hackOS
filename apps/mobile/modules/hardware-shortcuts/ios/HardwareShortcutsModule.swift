import ExpoModulesCore
import ObjectiveC
import UIKit

/// Command-key shortcuts as `UIKeyCommand`s on the key window's root view controller. They
/// reach it through the responder chain, so they fire while no text field holds the keys.
/// Commands carry no discoverability title: the system's shortcut overlay stays empty and
/// the app adds no visible copy. The shortcut set is owned by JavaScript (`setShortcuts`).
public class HardwareShortcutsModule: Module {
  private static let selector = NSSelectorFromString("hackosShortcut:")
  private var installed: [UIKeyCommand] = []
  private weak var host: UIViewController?

  public func definition() -> ModuleDefinition {
    Name("HardwareShortcuts")

    Events("onShortcut")

    /// `items`: `{ id, input }`, each triggered by Command + `input`. Replaces the previous set.
    Function("setShortcuts") { (items: [[String: String]]) in
      let apply = { self.install(items) }
      if Thread.isMainThread { apply() } else { DispatchQueue.main.sync(execute: apply) }
    }

    OnDestroy {
      DispatchQueue.main.async { self.install([]) }
    }
  }

  private func install(_ items: [[String: String]]) {
    guard let root = Self.keyWindow()?.rootViewController else { return }
    let target: UIViewController = root
    if target !== host {
      installed.forEach { host?.removeKeyCommand($0) }
      installed = []
      host = target
      // Add the action to the root controller's class once; it forwards to JavaScript.
      let block: @convention(block) (AnyObject, UIKeyCommand) -> Void = { [weak self] _, command in
        guard let id = command.propertyList as? String else { return }
        self?.sendEvent("onShortcut", ["id": id])
      }
      class_replaceMethod(
        type(of: target), Self.selector, imp_implementationWithBlock(block), "v@:@")
    }
    installed.forEach { target.removeKeyCommand($0) }
    installed = items.compactMap { item in
      guard let id = item["id"], let input = item["input"] else { return nil }
      let command = UIKeyCommand(
        title: "", action: Self.selector, input: input, modifierFlags: .command,
        propertyList: id)
      command.wantsPriorityOverSystemBehavior = true
      return command
    }
    installed.forEach { target.addKeyCommand($0) }
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }
}
