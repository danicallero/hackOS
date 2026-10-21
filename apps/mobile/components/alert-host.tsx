import { Fragment, useSyncExternalStore } from "react";
import { type AlertButton, Modal, Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import { type AlertRequest, currentAlert, dismissAlert, subscribeAlerts } from "@/lib/alert";
import { colors, motion, radius, space, type } from "@/theme";

const WIDTH = 270;

function buttonOrder(buttons: AlertButton[]): AlertButton[] {
  // UIKit puts Cancel on the leading side of a two-button alert.
  if (buttons.length !== 2 || buttons[0]?.style === "cancel") return buttons;
  return buttons[1]?.style === "cancel" ? [buttons[1], buttons[0]] : buttons;
}

// Read per render: Android colours resolve against the current scheme (theme/colors.ts).
const centered = () => ({ color: colors.label, textAlign: "center" }) as const;

function Divider({ vertical }: { vertical?: boolean }) {
  return (
    <View
      style={
        vertical
          ? { backgroundColor: colors.separator, width: 0.5 }
          : { backgroundColor: colors.separator, height: 0.5 }
      }
    />
  );
}

function AlertButtonView({ button, onPress }: { button: AlertButton; onPress: () => void }) {
  const color = button.style === "destructive" ? colors.destructive : colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? colors.separator : "transparent",
        flex: 1,
        justifyContent: "center",
        minHeight: 44,
        paddingHorizontal: space.md,
      })}
    >
      <Text
        style={[type.body, { color, fontWeight: button.style === "cancel" ? "600" : "400" }]}
        numberOfLines={2}
      >
        {button.text}
      </Text>
    </Pressable>
  );
}

function AlertCard({ request }: { request: AlertRequest }) {
  const buttons = buttonOrder(request.buttons);
  const horizontal = buttons.length === 2;
  const cancel = request.buttons.find((button) => button.style === "cancel");

  const answer = (button?: AlertButton) => {
    dismissAlert(request.id);
    button?.onPress?.();
  };
  // Android's Alert is dismissible only when asked; back falls back to Cancel.
  const dismiss = () => {
    if (cancel) answer(cancel);
    else if (request.options?.cancelable) {
      dismissAlert(request.id);
      request.options.onDismiss?.();
    }
  };

  return (
    <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={dismiss}>
      <Animated.View
        entering={FadeIn.duration(motion.duration.fast)}
        exiting={FadeOut.duration(motion.duration.fast)}
        style={{
          alignItems: "center",
          backgroundColor: colors.scrim,
          flex: 1,
          justifyContent: "center",
        }}
      >
        <Pressable
          accessibilityLabel={undefined}
          accessible={false}
          onPress={request.options?.cancelable ? dismiss : undefined}
          style={{ ...absoluteFill }}
        />
        <Animated.View
          accessibilityViewIsModal
          entering={ZoomIn.duration(motion.duration.base)}
          style={{
            backgroundColor: colors.elevatedSurface,
            borderCurve: "continuous",
            borderRadius: radius.container,
            overflow: "hidden",
            width: WIDTH,
          }}
        >
          <View style={{ gap: space.xxs, padding: space.lg, paddingBottom: space.lg }}>
            <Text accessibilityRole="header" style={[type.headline, centered()]}>
              {request.title}
            </Text>
            {request.message ? (
              <Text style={[type.footnote, centered()]}>{request.message}</Text>
            ) : null}
          </View>
          <Divider />
          <View style={{ flexDirection: horizontal ? "row" : "column" }}>
            {buttons.map((button, index) => (
              <Fragment key={button.text}>
                {index > 0 ? <Divider vertical={horizontal} /> : null}
                <AlertButtonView button={button} onPress={() => answer(button)} />
              </Fragment>
            ))}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const absoluteFill = { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 } as const;

/** Mount once at the app root; renders the Android alert queue (`lib/alert.ts`). */
export function AlertHost() {
  const request = useSyncExternalStore(subscribeAlerts, currentAlert, currentAlert);
  return request ? <AlertCard key={request.id} request={request} /> : null;
}
