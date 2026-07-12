"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Password field with a show/hide toggle. Reused by sign-up, sign-in and the
 * reset-password form so the affordance is consistent.
 */
export function PasswordInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  const [visible, setVisible] = useState(false);
  const { t } = useLocale();
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-10", className)} {...props} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="text-muted-foreground absolute top-1/2 right-1 size-7 -translate-y-1/2"
        aria-label={visible ? t("hidePassword") : t("showPassword")}
      >
        {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </Button>
    </div>
  );
}
