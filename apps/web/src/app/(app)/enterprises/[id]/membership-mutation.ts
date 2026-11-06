import { apiErrorText } from "@/lib/api-error-text";
import type { Translate } from "@/lib/i18n";
import { toast } from "@/lib/toast";

export async function mutateMembership({
  request,
  refresh,
  afterRequest,
  setBusy,
  t,
  success,
  failure,
  title,
}: {
  request: () => Promise<unknown>;
  refresh: () => void | Promise<void>;
  afterRequest?: () => void;
  setBusy: (busy: boolean) => void;
  t: Translate;
  success: string;
  failure: string;
  title: string;
}) {
  setBusy(true);
  try {
    await request();
    afterRequest?.();
    await refresh();
    toast.success(success, { compactTitle: title });
  } catch (err) {
    toast.error(apiErrorText(err, t, failure), title);
  } finally {
    setBusy(false);
  }
}
