import { OfflineNotice } from "@/components/status-notice";

/**
 * Shown whenever a screen is displaying cached data because the server
 * didn't respond. Dismissed by refreshing the data itself (pull-to-refresh).
 */
export function StaleDataBanner({ updatedAt }: { updatedAt: string | null }) {
  if (!updatedAt) return null;
  return <OfflineNotice updatedAt={updatedAt} />;
}
