import Svg, { Path } from "react-native-svg";
import type { SocialKind } from "@/lib/directory";
// Shared with plugins/withIosSocialGlyphs.js, which builds the iOS menu images.
import SOCIAL_GLYPH_PATHS from "@/lib/social-glyph-paths.json";
import { colors } from "@/theme";

/**
 * #934, #935: monochrome network glyphs for profile links. SF Symbols has no
 * brand marks, so these are Phosphor Icons' regular weight (MIT), inlined to
 * avoid bundling the whole set. The iOS system menu shows the same marks
 * from asset-catalog images built by `plugins/withIosSocialGlyphs.js`
 * (`socialGlyphAsset`).
 */
const PATHS: Record<SocialKind, string> = SOCIAL_GLYPH_PATHS;

export const SOCIAL_TILE_SIZE = 30;

export function SocialGlyph({
  kind,
  size = 18,
  color,
}: {
  kind: SocialKind;
  size?: number;
  color: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" accessible={false}>
      <Path d={PATHS[kind]} fill={color} />
    </Svg>
  );
}

/** The glyph on a neutral rounded tile, the row's leading icon (no brand colours). */
export function SocialTile({ kind }: { kind: SocialKind }) {
  return (
    <Svg width={SOCIAL_TILE_SIZE} height={SOCIAL_TILE_SIZE} viewBox="0 0 30 30" accessible={false}>
      <Path
        d="M7,0H23A7,7,0,0,1,30,7V23A7,7,0,0,1,23,30H7A7,7,0,0,1,0,23V7A7,7,0,0,1,7,0Z"
        fill={colors.iconTile as string}
      />
      <Path
        d={PATHS[kind]}
        fill={colors.onIconTile as string}
        transform="translate(6 6) scale(0.0703125)"
      />
    </Svg>
  );
}

/** The iOS asset-catalog image of a network mark, for system menus (#934, #935). */
export function socialGlyphAsset(kind: SocialKind): string {
  return `social.${kind}`;
}
