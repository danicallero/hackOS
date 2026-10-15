import { Image } from "expo-image";
import { useState } from "react";
import { FlatList, Modal, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingGlassButton } from "@/components/native-ui";
import { loadingImageStyle, useApiImage } from "@/components/person-avatar";
import { RequestFeedback } from "@/components/RequestFeedback";
import { useLocale } from "@/lib/i18n";
import type { ProjectFile } from "@/lib/projects";

function Page({ photo, width, height }: { photo: ProjectFile; width: number; height: number }) {
  const full = useApiImage(photo.url);
  return (
    <ScrollView
      style={{ height, width }}
      contentContainerStyle={{ height, width }}
      maximumZoomScale={4}
      minimumZoomScale={1}
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      {!full.loaded ? <RequestFeedback loading /> : null}
      {full.props ? (
        <Image
          {...full.props}
          accessibilityLabel={photo.fileName}
          contentFit="contain"
          style={[{ height, width }, !full.loaded && loadingImageStyle]}
        />
      ) : null}
    </ScrollView>
  );
}

/**
 * H16/H18: a photo-list answer full screen, as in Photos: swipe between
 * photos, pinch to zoom one, "2 of 5" above. Photos load from the
 * authenticated file route at full size.
 */
export function PhotoCarousel({
  photos,
  initialIndex,
  onClose,
}: {
  photos: ProjectFile[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);
  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View testID="photo-carousel" style={{ backgroundColor: "#000", flex: 1 }}>
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, item) => ({ length: width, offset: width * item, index: item })}
          keyExtractor={(photo) => photo.objectKey}
          onMomentumScrollEnd={(event) =>
            setIndex(Math.round(event.nativeEvent.contentOffset.x / width))
          }
          renderItem={({ item }) => <Page photo={item} width={width} height={height} />}
        />
        {photos.length > 1 ? (
          <View
            pointerEvents="none"
            style={{
              alignItems: "center",
              left: 72,
              position: "absolute",
              right: 72,
              top: insets.top + 26,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>
              {`${index + 1} / ${photos.length}`}
            </Text>
          </View>
        ) : null}
        <FloatingGlassButton
          top={insets.top + 16}
          side="left"
          icon="xmark"
          colorScheme="dark"
          tintColor="#fff"
          accessibilityLabel={t("close")}
          onPress={onClose}
        />
      </View>
    </Modal>
  );
}
