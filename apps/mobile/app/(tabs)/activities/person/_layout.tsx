import { Stack } from "expo-router/stack";

export default function ActivityPersonLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: process.env.EXPO_OS === "ios",
        headerTransparent: true,
        headerShadowVisible: false,
        headerTitle: "",
        headerBackVisible: false,
      }}
    />
  );
}
