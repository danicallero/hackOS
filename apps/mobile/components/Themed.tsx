import { Text as DefaultText, View as DefaultView, useColorScheme } from "react-native";
import { colors } from "@/theme/colors";

export type TextProps = DefaultText["props"];
export type ViewProps = DefaultView["props"];

export function Text(props: TextProps) {
  useColorScheme();
  const { style, ...otherProps } = props;

  return <DefaultText style={[{ color: colors.label }, style]} {...otherProps} />;
}

export function View(props: ViewProps) {
  useColorScheme();
  const { style, ...otherProps } = props;

  return <DefaultView style={[{ backgroundColor: colors.background }, style]} {...otherProps} />;
}
