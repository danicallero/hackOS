"use client";
import { useState } from "react";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { ContextualError } from "./contextual-error";
import { MultiSelect } from "./multi-select";
export interface LibraryValue {
  id: number;
  name: string;
  proposedBy?: number | null;
}
export function LibraryPicker({
  libraryId,
  value,
  onChange,
  disabled,
  id,
  inDialog = false,
  ...aria
}: {
  libraryId?: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  id?: string;
  inDialog?: boolean;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const catalogue = useServerResource(
    ["form-library", libraryId],
    (signal) => api.get<{ items: LibraryValue[] }>(`/api/form-libraries/${libraryId}`, { signal }),
    { enabled: Boolean(libraryId) && !disabled },
  );
  async function propose(name: string) {
    setBusy(true);
    setError(null);
    try {
      const item = await api.post<LibraryValue>(`/api/form-libraries/${libraryId}/proposals`, {
        name,
      });
      catalogue.mutate({
        items: [...(catalogue.data?.items ?? []).filter((entry) => entry.id !== item.id), item],
      });
      onChange([...new Set([...value, item.name])]);
      setQuery("");
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveLibrary")));
    } finally {
      setBusy(false);
    }
  }
  const names = [...new Set([...(catalogue.data?.items.map((item) => item.name) ?? []), ...value])];
  return (
    <div className="space-y-2">
      <MultiSelect
        id={id}
        {...aria}
        options={names.map((name) => ({ value: name, label: name }))}
        value={value}
        onChange={onChange}
        disabled={disabled || busy || !libraryId}
        inDialog={inDialog}
        searchQuery={query}
        onSearchChange={setQuery}
        onCreateOption={libraryId ? (name) => void propose(name) : undefined}
        creating={busy}
        maxVisibleBadges={6}
      />
      {(error || Boolean(catalogue.error)) && (
        <ContextualError
          message={error ?? apiErrorText(catalogue.error, t, t("couldNotLoadLibrary"))}
          onRetry={catalogue.reload}
        />
      )}
    </div>
  );
}
