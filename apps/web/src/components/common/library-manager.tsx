"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";
import { AlertModal } from "./alert-modal";
import { ContextualError } from "./contextual-error";
import type { LibraryValue } from "./library-picker";

export function LibraryManager({
  libraryId,
  managePath,
  onDirtyChange,
}: {
  libraryId?: string;
  managePath: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useLocale();
  const catalogue = useServerResource(
    ["form-library", libraryId],
    (signal) => api.get<{ items: LibraryValue[] }>(`/api/form-libraries/${libraryId}`, { signal }),
    { enabled: Boolean(libraryId) },
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [names, setNames] = useState<Record<number, string>>({});
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  useUnsavedChangesGuard(Object.keys(names).length > 0);
  useEffect(() => onDirtyChange?.(Object.keys(names).length > 0), [names, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const items = catalogue.data?.items ?? [];
  const filtered = items.filter((item) =>
    item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  async function addValue() {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/form-libraries/${libraryId}/proposals`, { name: query.trim() });
      setQuery("");
      catalogue.reload();
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveLibrary")));
    } finally {
      setBusy(false);
    }
  }
  async function save(action: "rename" | "delete" | "merge") {
    setBusy(true);
    setError(null);
    try {
      await api.post(managePath, {
        renames: Object.entries(names).map(([id, name]) => ({ id: Number(id), name })),
        deleteIds: action === "delete" ? selected : [],
        ...(action === "merge"
          ? {
              merge: {
                sourceIds: selected.filter((id) => String(id) !== target),
                targetId: Number(target),
              },
            }
          : {}),
      });
      setNames({});
      setSelected([]);
      setTarget("");
      setDeleting(false);
      catalogue.reload();
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveLibrary")));
    } finally {
      setBusy(false);
    }
  }
  if (!libraryId) return <p className="text-sm text-muted-foreground">{t("saveLibraryFirst")}</p>;
  return (
    <section
      aria-labelledby={`library-title-${libraryId}`}
      className="space-y-4 border-t border-border/60 pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`library-title-${libraryId}`} className="font-medium text-balance">
          {t("fieldKindLibrary")}{" "}
          <span className="text-muted-foreground text-sm tabular-nums">{items.length}</span>
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            busy || !Object.keys(names).length || Object.values(names).some((name) => !name.trim())
          }
          onClick={() => void save("rename")}
        >
          {t("saveLibrary")}
        </Button>
      </div>
      {(error || Boolean(catalogue.error)) && (
        <ContextualError
          message={error ?? apiErrorText(catalogue.error, t, t("couldNotLoadLibrary"))}
          onRetry={catalogue.reload}
        />
      )}
      <Input
        aria-label={t("searchLibrary")}
        placeholder={t("searchLibrary")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() &&
        !items.some(
          (item) => item.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
        ) && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void addValue()}>
            {t("addLibraryValue", { name: query.trim() })}
          </Button>
        )}
      <div className="max-h-80 overflow-y-auto rounded-control border">
        <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2">
          <Checkbox
            aria-label={t("selectAll")}
            checked={filtered.length > 0 && filtered.every((item) => selected.includes(item.id))}
            disabled={busy}
            onCheckedChange={(checked) =>
              setSelected(
                checked
                  ? [...new Set([...selected, ...filtered.map((item) => item.id)])]
                  : selected.filter((id) => !filtered.some((item) => item.id === id)),
              )
            }
          />
          <span className="text-sm text-muted-foreground">{t("libraryValues")}</span>
        </div>
        {filtered.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0"
          >
            <Checkbox
              aria-label={`${t("librarySelect")}: ${item.name}`}
              checked={selected.includes(item.id)}
              disabled={busy}
              onCheckedChange={(checked) =>
                setSelected(
                  checked ? [...selected, item.id] : selected.filter((id) => id !== item.id),
                )
              }
            />
            <Input
              aria-label={`${t("libraryRename")}: ${item.name}`}
              value={names[item.id] ?? item.name}
              disabled={busy}
              onChange={(event) => setNames({ ...names, [item.id]: event.target.value })}
            />
          </div>
        ))}
        {!filtered.length && (
          <p className="p-4 text-sm text-muted-foreground">{t("noResultsLabel")}</p>
        )}
      </div>
      {selected.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-sm tabular-nums">
              {t("librarySelected", { count: selected.length })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setDeleting(true)}
            >
              {t("remove")}
            </Button>
          </div>
          <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor={`merge-library-${libraryId}`}>{t("mergeLibraryInto")}</Label>
              <Select value={target} onValueChange={setTarget} disabled={busy}>
                <SelectTrigger id={`merge-library-${libraryId}`} className="w-full">
                  <SelectValue placeholder={t("selectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !target || selected.every((id) => String(id) === target)}
              onClick={() => void save("merge")}
            >
              {t("mergeLibraryValues")}
            </Button>
          </div>
        </div>
      )}
      <AlertModal
        open={deleting}
        onOpenChange={setDeleting}
        title={t("deleteLibraryValuesTitle")}
        description={t("deleteLibraryValuesDescription")}
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
        destructive
        pending={busy}
        onConfirm={() => void save("delete")}
      />
    </section>
  );
}
