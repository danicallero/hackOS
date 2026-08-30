import { useScrollToTop } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, ScrollView, useColorScheme, View } from "react-native";

import { ActionButton, InfoRow, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import {
  clearAllCaches,
  formatBytes,
  getStorageUsage,
  type StorageUsage,
} from "@/lib/storage-usage";
import { isOperator } from "@/lib/tabs";

/** Device-storage controls. Staff metrics live on the separate Statistics page. */
export default function StorageScreen() {
  useColorScheme();
  const { t } = useLocale();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  const { me, loading, error, refetch } = useMeContext();
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [storageError, setStorageError] = useState<Error | null>(null);

  useScrollToTop(scrollRef);

  const operator = isOperator(me?.capabilities ?? []);

  const loadStorageUsage = useCallback(async () => {
    setStorageUsage(await getStorageUsage());
  }, []);

  useEffect(() => {
    void loadStorageUsage();
  }, [loadStorageUsage]);

  async function clearCache() {
    if (clearingCache) return;
    setClearingCache(true);
    setStorageError(null);
    try {
      await clearAllCaches(operator);
      await loadStorageUsage();
    } catch (cause) {
      setStorageError(cause instanceof Error ? cause : new Error(t("storageClearError")));
    } finally {
      setClearingCache(false);
    }
  }

  function confirmClearCache() {
    Alert.alert(t("storageClearConfirmTitle"), t("storageClearConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("storageClearAction"), style: "destructive", onPress: () => void clearCache() },
    ]);
  }

  if (loading && !me) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <RequestFeedback loading />
      </View>
    );
  }
  if (!me) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <RequestFeedback error={error} onRetry={() => void refetch()} />
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        gap: 20,
        padding: 16,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
      }}
    >
      {storageError ? (
        <RequestFeedback
          error={storageError}
          message={t("storageClearError")}
          onRetry={confirmClearCache}
          retrying={clearingCache}
        />
      ) : null}

      <Section title={t("storageDataTitle")} footer={t("storageFooter")}>
        <InfoRow
          label={t("storageOfflineData")}
          value={storageUsage ? formatBytes(storageUsage.offlineDataBytes) : "—"}
          icon="arrow.down.circle"
        />
        <Separator inset={48} />
        <InfoRow
          label={t("storageDownloadedFiles")}
          value={storageUsage ? formatBytes(storageUsage.downloadedFilesBytes) : "—"}
          icon="doc"
        />
        <Separator inset={48} />
        <InfoRow
          label={t("storageTotal")}
          value={storageUsage ? formatBytes(storageUsage.totalBytes) : "—"}
          icon="internaldrive.fill"
        />
        <Separator />
        <ActionButton
          label={t("storageClearAction")}
          icon="trash"
          destructive
          busy={clearingCache}
          onPress={confirmClearCache}
        />
      </Section>
    </ScrollView>
  );
}
