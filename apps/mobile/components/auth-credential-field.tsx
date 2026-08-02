import { useImperativeHandle, useRef } from "react";
import type { NativeSyntheticEvent, TextInput, TextInputEndEditingEventData } from "react-native";

import type { AuthCredentialFieldProps } from "@/components/auth-credential-field.types";
import { AuthField } from "@/components/auth-ui";

export type { AuthCredentialFieldHandle } from "@/components/auth-credential-field.types";

/**
 * Keep the native field uncontrolled so Password AutoFill owns its text while
 * Passwords/Face ID temporarily moves the app out of the foreground.
 */
export function AuthCredentialField({
  fieldRef,
  onChangeText,
  onSubmitEditing,
  ...props
}: AuthCredentialFieldProps) {
  const nativeRef = useRef<TextInput>(null);
  const textRef = useRef("");

  useImperativeHandle(fieldRef, () => ({
    focus: () => nativeRef.current?.focus(),
    getText: () => textRef.current,
  }));

  const handleChangeText = (value: string) => {
    textRef.current = value;
    onChangeText(value);
  };

  const handleEndEditing = ({
    nativeEvent,
  }: NativeSyntheticEvent<TextInputEndEditingEventData>) => {
    handleChangeText(nativeEvent.text);
  };

  return (
    <AuthField
      {...props}
      inputRef={nativeRef}
      autoCapitalize="none"
      autoCorrect={false}
      importantForAutofill="yes"
      spellCheck={false}
      onChangeText={handleChangeText}
      onEndEditing={handleEndEditing}
      onSubmitEditing={onSubmitEditing}
    />
  );
}
