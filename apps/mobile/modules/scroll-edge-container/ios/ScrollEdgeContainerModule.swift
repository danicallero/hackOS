import ExpoModulesCore
import UIKit

/** H45: UIKit extends the scroll edge behind a pinned date instead of painting a second material. */
public class ScrollEdgeContainerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ScrollEdgeContainer")
    View(ScrollEdgeContainerView.self) {
      Prop("title") { (view: ScrollEdgeContainerView, value: String) in view.title = value }
      Prop("horizontalInset") { (view: ScrollEdgeContainerView, value: Double) in
        view.horizontalInset = CGFloat(value)
      }
    }
  }
}

final class ScrollEdgeContainerView: ExpoView {
  private let titleLabel = UILabel()
  var title: String = "" { didSet { titleLabel.text = title } }
  var horizontalInset: CGFloat = 0 { didSet { setNeedsLayout() } }
  private var edgeInteraction: UIInteraction?
  private var pinnedContainer: UIView?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // UIKit recognizes UILabel as an edge-protected element; RN's paragraph view is not one.
    let sectionFont = UIFont.preferredFont(forTextStyle: .footnote)
    let descriptor = sectionFont.fontDescriptor.addingAttributes([
      .traits: [UIFontDescriptor.TraitKey.weight: UIFont.Weight.semibold]
    ])
    titleLabel.font = UIFont(descriptor: descriptor, size: sectionFont.pointSize + 1)
    titleLabel.textColor = .secondaryLabel
    titleLabel.adjustsFontForContentSizeCategory = true
    titleLabel.accessibilityTraits.insert(.header)
    addSubview(titleLabel)
  }
  private weak var contentScrollView: UIScrollView?
  private var offsetObservation: NSKeyValueObservation?

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      clearPinnedContainer()
      contentScrollView = nil
      offsetObservation?.invalidate()
      offsetObservation = nil
    } else {
      connectScrollEdge()
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    titleLabel.frame = bounds.insetBy(dx: horizontalInset, dy: 0)
    connectScrollEdge()
  }

  private func connectScrollEdge() {
    guard #available(iOS 26.0, *), window != nil else { return }
    var ancestor = superview
    while let view = ancestor {
      if let scrollView = view as? UIScrollView {
        if contentScrollView !== scrollView {
          clearPinnedContainer()
          offsetObservation?.invalidate()
          contentScrollView = scrollView
          offsetObservation = scrollView.observe(\.contentOffset, options: [.initial, .new]) { [weak self] _, _ in
            // RN's native sticky transform is applied during the scroll callback.
            DispatchQueue.main.async { self?.updatePinnedProtection() }
          }
        }
        updatePinnedProtection()
        return
      }
      ancestor = view.superview
    }
  }
  private func updatePinnedProtection() {
    guard #available(iOS 26.0, *), let scrollView = contentScrollView else { return }
    let viewportY = convert(bounds, to: scrollView).minY - scrollView.bounds.minY
    let pinnedY = scrollView.adjustedContentInset.top
    let pinned = abs(viewportY - pinnedY) < 1 && !title.isEmpty
    if pinned, let parent = scrollView.superview {
      let container: UIView
      if let existing = pinnedContainer {
        container = existing
      } else {
        container = UIView()
        container.isUserInteractionEnabled = false
        container.clipsToBounds = true
        parent.addSubview(container)
        titleLabel.removeFromSuperview()
        container.addSubview(titleLabel)
        pinnedContainer = container
        let interaction = UIScrollEdgeElementContainerInteraction()
        interaction.scrollView = scrollView
        interaction.edge = .top
        container.addInteraction(interaction)
        edgeInteraction = interaction
        scrollView.topEdgeEffect.style = .soft
      }
      let viewport = scrollView.convert(scrollView.bounds, to: parent)
      container.frame = CGRect(x: viewport.minX, y: viewport.minY + pinnedY,
                               width: viewport.width, height: bounds.height)
      titleLabel.frame = container.bounds.insetBy(dx: horizontalInset, dy: 0)
    } else {
      clearPinnedContainer()
    }
  }

  private func clearPinnedContainer() {
    if let edgeInteraction { pinnedContainer?.removeInteraction(edgeInteraction) }
    edgeInteraction = nil
    if pinnedContainer != nil {
      titleLabel.removeFromSuperview()
      addSubview(titleLabel)
      titleLabel.frame = bounds.insetBy(dx: horizontalInset, dy: 0)
      pinnedContainer?.removeFromSuperview()
      pinnedContainer = nil
    }
  }
}
