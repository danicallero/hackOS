import type { RefObject } from "react";

export type AuthCredentialFieldHandle = {
  focus: () => void;
  getText: () => string;
};

export type AuthCredentialFieldProps = {
  autoComplete: "username" | "current-password";
  error?: string | null;
  fieldRef: RefObject<AuthCredentialFieldHandle | null>;
  hidePasswordLabel?: string;
  keyboardType?: "default" | "email-address";
  label: string;
  onChangeText: (value: string) => void;
  onSubmitEditing: () => void;
  placeholder?: string;
  returnKeyType: "next" | "go";
  secureTextEntry?: boolean;
  showPasswordLabel?: string;
  testID: string;
};
