import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { SymbolView } from "@/components/symbol";
import { diaryInitials } from "@/lib/diary";
import { loadApiImage } from "@/lib/directory";
import { colors } from "@/theme/colors";

/**
 * A directory photo, initials or a placeholder symbol (#934). Initials show
 * until the authenticated photo arrives. Person photos are round and cropped;
 * sponsor logos keep their shape inside a rounded tile.
 */
export function PersonAvatar({
  size,
  name,
  uri,
  kind = "person",
}: {
  size: number;
  name?: string | null;
  uri: string | null;
  kind?: "person" | "sponsor";
}) {
  const [loaded, setLoaded] = useState<{ uri: string; source: string } | null>(null);
  useEffect(() => {
    if (!uri) return;
    let active = true;
    loadApiImage(uri).then(
      (source) => {
        if (active) setLoaded({ uri, source });
      },
      () => {
        // A missing or hidden photo keeps the initials.
      },
    );
    return () => {
      active = false;
    };
  }, [uri]);
  const source = loaded && loaded.uri === uri ? loaded.source : null;
  const frame = {
    alignItems: "center" as const,
    backgroundColor: colors.elevatedSurface,
    borderRadius: kind === "person" ? size / 2 : size * 0.23,
    height: size,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
    width: size,
  };
  if (source) {
    return (
      <View style={frame}>
        <Image
          accessible={false}
          source={{ uri: source }}
          resizeMode={kind === "person" ? "cover" : "contain"}
          style={{ height: size, width: size }}
        />
      </View>
    );
  }
  if (name) {
    return (
      // Tinted like the account avatar, so it reads on grouped and plain grounds.
      <View style={[frame, { backgroundColor: colors.accentSurface }]}>
        <Text
          accessible={false}
          style={{ color: colors.onAccentSurface, fontSize: size * 0.36, fontWeight: "600" }}
        >
          {diaryInitials(name)}
        </Text>
      </View>
    );
  }
  return (
    <View style={frame}>
      <SymbolView
        accessible={false}
        name={kind === "person" ? "person.fill" : "building.2"}
        size={size * 0.45}
        tintColor={colors.secondaryLabel}
      />
    </View>
  );
}
