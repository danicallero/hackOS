import { mascotAvatarChoice } from "@hackos/shared/mascot-avatars";

const assets = [
  require("@hackos/shared/assets/avatars/emilia-original.png"),
  require("@hackos/shared/assets/avatars/emilia-center.png"),
  require("@hackos/shared/assets/avatars/emilia-left.png"),
  require("@hackos/shared/assets/avatars/emilia-right.png"),
  require("@hackos/shared/assets/avatars/emilia-close.png"),
  require("@hackos/shared/assets/avatars/emilia-top.png"),
  require("@hackos/shared/assets/avatars/emilia-peek.png"),
  require("@hackos/shared/assets/avatars/emilia-step-center.png"),
  require("@hackos/shared/assets/avatars/emilia-step-left.png"),
  require("@hackos/shared/assets/avatars/emilia-step-right.png"),
  require("@hackos/shared/assets/avatars/emilia-step-close.png"),
  require("@hackos/shared/assets/avatars/emilia-step-top.png"),
  require("@hackos/shared/assets/avatars/emilia-step-peek.png"),
  require("@hackos/shared/assets/avatars/crab-center.png"),
  require("@hackos/shared/assets/avatars/crab-left.png"),
  require("@hackos/shared/assets/avatars/crab-right.png"),
  require("@hackos/shared/assets/avatars/crab-close.png"),
  require("@hackos/shared/assets/avatars/crab-top.png"),
  require("@hackos/shared/assets/avatars/crab-peek.png"),
  require("@hackos/shared/assets/avatars/shrimp-center.png"),
  require("@hackos/shared/assets/avatars/shrimp-left.png"),
  require("@hackos/shared/assets/avatars/shrimp-right.png"),
  require("@hackos/shared/assets/avatars/shrimp-close.png"),
  require("@hackos/shared/assets/avatars/shrimp-top.png"),
  require("@hackos/shared/assets/avatars/shrimp-peek.png"),
  require("@hackos/shared/assets/avatars/shell-center.png"),
  require("@hackos/shared/assets/avatars/shell-left.png"),
  require("@hackos/shared/assets/avatars/shell-right.png"),
  require("@hackos/shared/assets/avatars/shell-close.png"),
  require("@hackos/shared/assets/avatars/shell-top.png"),
  require("@hackos/shared/assets/avatars/shell-peek.png"),
];

export function mascotAvatar(userId?: string | number | null, name = ""): number {
  return assets[mascotAvatarChoice(userId, name).index];
}

/** The no-photo header uses the same colour as its avatar (#934, H48). */
export function mascotBackgroundRgb(
  userId?: string | number | null,
  name = "",
): [number, number, number] {
  const hex = mascotAvatarChoice(userId, name).background;
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}
