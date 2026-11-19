import avatar13 from "@hackos/shared/assets/avatars/crab-center.png";
import avatar16 from "@hackos/shared/assets/avatars/crab-close.png";
import avatar14 from "@hackos/shared/assets/avatars/crab-left.png";
import avatar18 from "@hackos/shared/assets/avatars/crab-peek.png";
import avatar15 from "@hackos/shared/assets/avatars/crab-right.png";
import avatar17 from "@hackos/shared/assets/avatars/crab-top.png";
import avatar1 from "@hackos/shared/assets/avatars/emilia-center.png";
import avatar4 from "@hackos/shared/assets/avatars/emilia-close.png";
import avatar2 from "@hackos/shared/assets/avatars/emilia-left.png";
import avatar0 from "@hackos/shared/assets/avatars/emilia-original.png";
import avatar6 from "@hackos/shared/assets/avatars/emilia-peek.png";
import avatar3 from "@hackos/shared/assets/avatars/emilia-right.png";
import avatar7 from "@hackos/shared/assets/avatars/emilia-step-center.png";
import avatar10 from "@hackos/shared/assets/avatars/emilia-step-close.png";
import avatar8 from "@hackos/shared/assets/avatars/emilia-step-left.png";
import avatar12 from "@hackos/shared/assets/avatars/emilia-step-peek.png";
import avatar9 from "@hackos/shared/assets/avatars/emilia-step-right.png";
import avatar11 from "@hackos/shared/assets/avatars/emilia-step-top.png";
import avatar5 from "@hackos/shared/assets/avatars/emilia-top.png";
import avatar25 from "@hackos/shared/assets/avatars/shell-center.png";
import avatar28 from "@hackos/shared/assets/avatars/shell-close.png";
import avatar26 from "@hackos/shared/assets/avatars/shell-left.png";
import avatar30 from "@hackos/shared/assets/avatars/shell-peek.png";
import avatar27 from "@hackos/shared/assets/avatars/shell-right.png";
import avatar29 from "@hackos/shared/assets/avatars/shell-top.png";
import avatar19 from "@hackos/shared/assets/avatars/shrimp-center.png";
import avatar22 from "@hackos/shared/assets/avatars/shrimp-close.png";
import avatar20 from "@hackos/shared/assets/avatars/shrimp-left.png";
import avatar24 from "@hackos/shared/assets/avatars/shrimp-peek.png";
import avatar21 from "@hackos/shared/assets/avatars/shrimp-right.png";
import avatar23 from "@hackos/shared/assets/avatars/shrimp-top.png";
import { mascotAvatarChoice } from "@hackos/shared/mascot-avatars";

const assets = [
  avatar0,
  avatar1,
  avatar2,
  avatar3,
  avatar4,
  avatar5,
  avatar6,
  avatar7,
  avatar8,
  avatar9,
  avatar10,
  avatar11,
  avatar12,
  avatar13,
  avatar14,
  avatar15,
  avatar16,
  avatar17,
  avatar18,
  avatar19,
  avatar20,
  avatar21,
  avatar22,
  avatar23,
  avatar24,
  avatar25,
  avatar26,
  avatar27,
  avatar28,
  avatar29,
  avatar30,
];

export function mascotAvatarUrl(userId?: string | number | null, name = ""): string {
  const asset = assets[mascotAvatarChoice(userId, name).index];
  return typeof asset === "string" ? asset : asset.src;
}
