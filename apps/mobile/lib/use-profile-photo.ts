import * as ImagePicker from "expo-image-picker";
import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import { ApiError } from "./api";
import { type MessageKey, useLocale } from "./i18n";
import { createIdempotencyKey } from "./idempotency-key";
import { useMeContext } from "./me-context";
import { deletePhoto, preparePhoto, uploadPhoto } from "./profile-photo";

export type ProfilePhotoAction = "camera" | "library" | "remove";

/**
 * Add, replace or remove the account photo (#934). One hook behind every
 * control that edits it. `pending` drives the avatar's loading state and the
 * result refreshes /api/me, whose photo route carries a new `?v=` so every
 * avatar reloads instead of showing the cached image.
 */
export function useProfilePhoto() {
  const { t } = useLocale();
  const { refetch } = useMeContext();
  const [pending, setPending] = useState<ProfilePhotoAction | null>(null);
  const busy = useRef(false);

  const run = useCallback(
    async (action: ProfilePhotoAction) => {
      if (busy.current) return;
      busy.current = true;
      setPending(action);
      // One key per attempt: a retried request replays instead of re-applying.
      const key = createIdempotencyKey();
      try {
        if (action === "remove") {
          await deletePhoto(key);
        } else {
          if (action === "camera") {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
              Alert.alert(t("profilePhotoTitle"), t("profilePhotoCameraDenied"));
              return;
            }
          }
          const options: ImagePicker.ImagePickerOptions = {
            allowsEditing: true,
            aspect: [1, 1],
            mediaTypes: ["images"],
            quality: 1,
          };
          const result =
            action === "camera"
              ? await ImagePicker.launchCameraAsync(options)
              : await ImagePicker.launchImageLibraryAsync(options);
          const asset = result.canceled ? null : result.assets[0];
          if (!asset) return;
          await uploadPhoto(await preparePhoto(asset), key);
        }
        await refetch();
      } catch (cause) {
        Alert.alert(t("profilePhotoTitle"), photoErrorMessage(cause, action, t));
      } finally {
        busy.current = false;
        setPending(null);
      }
    },
    [refetch, t],
  );

  return { pending, run };
}

function photoErrorMessage(
  cause: unknown,
  action: ProfilePhotoAction,
  t: (key: MessageKey) => string,
): string {
  if (cause instanceof ApiError && cause.status === 409) return t("profilePhotoAccountRemoving");
  if (cause instanceof ApiError && (cause.status === 400 || cause.status === 413)) {
    return t("profilePhotoRejected");
  }
  return t(action === "remove" ? "profilePhotoRemoveError" : "profilePhotoUploadError");
}
