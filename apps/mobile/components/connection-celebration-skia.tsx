import {
  Blur,
  Canvas,
  Circle,
  ColorMatrix,
  Group,
  matchFont,
  Paint,
  type SkImage,
  Skia,
  Image as SkiaImage,
  Text as SkiaText,
} from "@shopify/react-native-skia";
import { useEffect, useMemo, useState } from "react";
import { Platform, useColorScheme, View } from "react-native";
import { type SharedValue, useDerivedValue } from "react-native-reanimated";
import { avatarInitials } from "@/components/user-avatar";
import { loadApiImage } from "@/lib/directory";

/**
 * The gooey merge of the connection celebration (#935), drawn with Skia. The
 * photos travel as shared values, so every frame stays on the UI thread.
 * `connection-celebration.tsx` owns the timing, haptics and the fallback; it
 * renders this only when motion is allowed and Skia loaded.
 */

// Skia paints with plain color strings, while the app palette is made of
// platform dynamic colors on iOS. These are the same systemBlue / grouped
// ground values, resolved from the color scheme.
const PALETTE = {
  light: { accent: "#007aff", ground: "#f2f2f7" },
  dark: { accent: "#0a84ff", ground: "#000000" },
} as const;
const ON_ACCENT = "#ffffff";

/** Goo: blur the blobs, then threshold the alpha so close blobs fuse. */
const GOO_BLUR = 14;
const GOO_MATRIX = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 60, -30];
/** How far the fused blob shows beyond each photo: the accent rim. */
const RIM = 5;
const PARTICLE_COUNT = 10;

async function decodeImage(source: string): Promise<SkImage | null> {
  const inline = /^data:[^,]*;base64,(.*)$/s.exec(source);
  const data = inline ? Skia.Data.fromBase64(inline[1]) : await Skia.Data.fromURI(source);
  return Skia.Image.MakeImageFromEncoded(data);
}

/**
 * The photo as a Skia image. The route is authenticated, so the bytes come
 * from the app's own loader (session cookie) rather than from Skia's fetch;
 * null until decoded, or for good when there is no photo or it cannot load.
 */
function useSkiaPhoto(uri: string | null | undefined): SkImage | null {
  const [loaded, setLoaded] = useState<{ uri: string; image: SkImage } | null>(null);
  useEffect(() => {
    if (!uri) return;
    let active = true;
    loadApiImage(uri)
      .then(decodeImage)
      .then((image) => {
        if (active && image) setLoaded({ uri, image });
      })
      .catch(() => {
        // The initials stay.
      });
    return () => {
      active = false;
    };
  }, [uri]);
  return uri && loaded && loaded.uri === uri ? loaded.image : null;
}

export interface SkiaPerson {
  name: string;
  image: string | null;
}

export function ConnectionMergeCanvas({
  width,
  height,
  avatar,
  travel,
  apart,
  approach,
  pop,
  burst,
  self,
  other,
}: {
  width: number;
  height: number;
  avatar: number;
  /** How far outside the rest position the photos start. */
  travel: number;
  /** Rest offset of each photo from the center. */
  apart: number;
  approach: SharedValue<number>;
  pop: SharedValue<number>;
  burst: SharedValue<number>;
  self: SkiaPerson;
  other: SkiaPerson;
}) {
  const palette = PALETTE[useColorScheme() === "dark" ? "dark" : "light"];
  const cx = width / 2;
  const cy = height / 2;
  const radius = avatar / 2;

  const leftX = useDerivedValue(() => cx - apart - (1 - approach.value) * travel);
  const rightX = useDerivedValue(() => cx + apart + (1 - approach.value) * travel);
  const blobR = useDerivedValue(() => (radius + RIM) * pop.value);
  const ringR = useDerivedValue(() => radius * (0.5 + burst.value * 2.4));
  // Nothing shows at the join until the burst starts.
  const ringOpacity = useDerivedValue(() => (burst.value > 0 ? (1 - burst.value) * 0.7 : 0));

  return (
    <View testID="connection-celebration-burst" pointerEvents="none" style={{ height, width }}>
      <Canvas testID="connection-celebration-skia" style={{ height, width }}>
        <Group
          layer={
            <Paint>
              <Blur blur={GOO_BLUR} />
              <ColorMatrix matrix={GOO_MATRIX} />
            </Paint>
          }
        >
          <Circle cx={leftX} cy={cy} r={blobR} color={palette.accent} />
          <Circle cx={rightX} cy={cy} r={blobR} color={palette.accent} />
        </Group>
        <Circle
          cx={cx}
          cy={cy}
          r={ringR}
          style="stroke"
          strokeWidth={3}
          color={palette.accent}
          opacity={ringOpacity}
        />
        {Array.from({ length: PARTICLE_COUNT }, (_, index) => (
          <Particle
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed ring of identical particles.
            key={index}
            index={index}
            cx={cx}
            cy={cy}
            burst={burst}
            color={palette.accent}
          />
        ))}
        <Photo
          x={leftX}
          y={cy}
          pop={pop}
          radius={radius}
          person={self}
          accent={palette.accent}
          ground={palette.ground}
        />
        <Photo
          x={rightX}
          y={cy}
          pop={pop}
          radius={radius}
          person={other}
          accent={palette.accent}
          ground={palette.ground}
        />
      </Canvas>
    </View>
  );
}

function Particle({
  index,
  cx,
  cy,
  burst,
  color,
}: {
  index: number;
  cx: number;
  cy: number;
  burst: SharedValue<number>;
  color: string;
}) {
  const angle = (index / PARTICLE_COUNT) * Math.PI * 2;
  const reach = index % 2 === 0 ? 150 : 110;
  const size = index % 2 === 0 ? 5 : 3.5;
  const x = useDerivedValue(() => cx + Math.cos(angle) * reach * burst.value);
  const y = useDerivedValue(() => cy + Math.sin(angle) * reach * burst.value);
  const r = useDerivedValue(() => size * (1 - burst.value * 0.7));
  const opacity = useDerivedValue(() => (burst.value > 0 ? 1 - burst.value : 0));
  return <Circle cx={x} cy={y} r={r} color={color} opacity={opacity} />;
}

/** One person: the photo clipped round, or initials on the accent until it loads. */
function Photo({
  x,
  y,
  pop,
  radius,
  person,
  accent,
  ground,
}: {
  x: SharedValue<number>;
  y: number;
  pop: SharedValue<number>;
  radius: number;
  person: SkiaPerson;
  accent: string;
  ground: string;
}) {
  const photo = useSkiaPhoto(person.image);
  const clip = useMemo(() => {
    const path = Skia.Path.Make();
    path.addCircle(0, 0, radius);
    return path;
  }, [radius]);
  const font = useMemo(
    () =>
      matchFont({
        fontFamily: Platform.select({ ios: "Helvetica Neue", default: "sans-serif" }),
        fontSize: Math.round(radius * 0.72),
        fontWeight: "bold",
      }),
    [radius],
  );
  const initials = avatarInitials(person.name);
  const transform = useDerivedValue(() => [
    { translateX: x.value },
    { translateY: y },
    { scale: pop.value },
  ]);
  const textX = font ? -font.measureText(initials).width / 2 : 0;
  const textY = font ? font.getSize() * 0.35 : 0;

  return (
    <Group transform={transform}>
      <Group clip={clip}>
        {photo ? (
          <SkiaImage
            image={photo}
            x={-radius}
            y={-radius}
            width={radius * 2}
            height={radius * 2}
            fit="cover"
          />
        ) : (
          <>
            <Circle cx={0} cy={0} r={radius} color={accent} />
            {font ? (
              <SkiaText x={textX} y={textY} text={initials} font={font} color={ON_ACCENT} />
            ) : null}
          </>
        )}
      </Group>
      <Circle cx={0} cy={0} r={radius} style="stroke" strokeWidth={4} color={ground} />
    </Group>
  );
}
