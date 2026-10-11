package expo.modules.profilegooey

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ProfileGooeyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ProfileGooey")

    // All values are dp in the view's own coordinates. The hole is static;
    // the avatar frame is animated from a Reanimated worklet
    // (`profileGooeyFrame` in lib/profile-avatar-collapse.ts).
    View(ProfileGooeyView::class) {
      Prop("holeX") { view: ProfileGooeyView, value: Float -> view.holeX = value; view.invalidate() }
      Prop("holeY") { view: ProfileGooeyView, value: Float -> view.holeY = value; view.invalidate() }
      Prop("holeDiameter") { view: ProfileGooeyView, value: Float -> view.holeDiameter = value; view.invalidate() }
      Prop("avatarX") { view: ProfileGooeyView, value: Float -> view.avatarX = value; view.invalidate() }
      Prop("avatarY") { view: ProfileGooeyView, value: Float -> view.avatarY = value; view.invalidate() }
      Prop("avatarDiameter") { view: ProfileGooeyView, value: Float -> view.avatarDiameter = value; view.invalidate() }
      Prop("imageAlpha") { view: ProfileGooeyView, value: Float -> view.imageAlpha = value; view.invalidate() }
      Prop("blurRadius") { view: ProfileGooeyView, value: Float -> view.blurRadius = value; view.invalidate() }
      Prop("bridgeReach") { view: ProfileGooeyView, value: Float -> view.bridgeReach = value; view.invalidate() }
      Prop("drip") { view: ProfileGooeyView, value: Float -> view.drip = value; view.invalidate() }
    }
  }
}
