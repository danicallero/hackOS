import { act, screen } from "@testing-library/react-native";
import { useState } from "react";
import { Dimensions, Text, TextInput, View } from "react-native";
import { AdaptiveFrame } from "@/components/adaptive-frame";
import { MAX_CONTENT_WIDTH, useWindowSizeClass } from "@/lib/window-size";
import { renderMobile } from "./render";

/** Foldables and large windows: one tree at every width, state kept across resizes. */

function Draft() {
  const [text, setText] = useState("");
  const { sizeClass } = useWindowSizeClass();
  return (
    <View>
      <TextInput accessibilityLabel="draft" value={text} onChangeText={setText} />
      <Text testID="size-class">{sizeClass}</Text>
    </View>
  );
}

function setWindow(width: number, height: number) {
  const metrics = { width, height, scale: 2, fontScale: 1 };
  Dimensions.set({ window: metrics, screen: metrics });
}

describe("adaptive layout", () => {
  beforeEach(() => setWindow(390, 844));

  it("caps the content column on wide windows without changing the tree", async () => {
    await renderMobile(
      <AdaptiveFrame>
        <View testID="content" />
      </AdaptiveFrame>,
    );
    const column = screen.getByTestId("content").parent;
    expect(column?.props.style).toMatchObject({ maxWidth: MAX_CONTENT_WIDTH, width: "100%" });
  });

  it("keeps a typed draft while the window folds, unfolds and resizes", async () => {
    await renderMobile(
      <AdaptiveFrame>
        <Draft />
      </AdaptiveFrame>,
    );
    expect(screen.getByTestId("size-class").props.children).toBe("compact");
    await act(async () => {
      screen.getByLabelText("draft").props.onChangeText("half-written note");
    });

    // Unfold to a Pixel Fold-sized window, then fold back to the cover display.
    await act(async () => setWindow(841, 700));
    expect(screen.getByTestId("size-class").props.children).toBe("expanded");
    expect(screen.getByLabelText("draft").props.value).toBe("half-written note");

    await act(async () => setWindow(360, 780));
    expect(screen.getByTestId("size-class").props.children).toBe("compact");
    expect(screen.getByLabelText("draft").props.value).toBe("half-written note");
  });
});
