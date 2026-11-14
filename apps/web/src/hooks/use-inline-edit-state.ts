"use client";

import { useEffect, useRef, useState } from "react";

export function useInlineEditState(value: string) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  return { editing, setEditing, draft, setDraft, saving, setSaving, inputRef };
}
