"use client";

// Field-kind metadata (labels, icons) and the add-field menu shared by the question builder.

// Field-kind metadata (labels, icons) and the add-field menu shared by the question builder.

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { CalendarIcon } from "@phosphor-icons/react/dist/csr/Calendar";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckSquareIcon } from "@phosphor-icons/react/dist/csr/CheckSquare";
import { GraduationCapIcon } from "@phosphor-icons/react/dist/csr/GraduationCap";
import { HashIcon } from "@phosphor-icons/react/dist/csr/Hash";
import { ImagesIcon } from "@phosphor-icons/react/dist/csr/Images";
import { ListChecksIcon } from "@phosphor-icons/react/dist/csr/ListChecks";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { PaperclipIcon } from "@phosphor-icons/react/dist/csr/Paperclip";
import { PhoneIcon } from "@phosphor-icons/react/dist/csr/Phone";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { RadioButtonIcon } from "@phosphor-icons/react/dist/csr/RadioButton";
import { TextAlignLeftIcon } from "@phosphor-icons/react/dist/csr/TextAlignLeft";
import { TextTIcon } from "@phosphor-icons/react/dist/csr/TextT";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BUILDER_FIELD_KINDS,
  type FieldKind,
  PROJECT_BUILDER_FIELD_KINDS,
} from "@/lib/applications";
import { type Translate, useLocale } from "@/lib/i18n";

export function fieldKindLabel(kind: FieldKind, t: Translate): string {
  const map: Record<FieldKind, string> = {
    library: t("fieldKindLibrary"),
    text: t("fieldKindText"),
    textarea: t("fieldKindTextarea"),
    select: t("fieldKindSelect"),
    multiselect: t("fieldKindMultiselect"),
    checkbox: t("fieldKindCheckbox"),
    birth_year: t("fieldKindBirthYear"),
    date: t("fieldKindDate"),
    number: t("fieldKindNumber"),
    phone: t("fieldKindPhone"),
    file: t("fieldKindFile"),
    university: t("fieldKindUniversity"),
    degree: t("fieldKindDegree"),
    city: t("fieldKindCity"),
    images: t("fieldKindImages"),
  };
  return map[kind];
}

const FIELD_KIND_ICON: Record<FieldKind, PhosphorIcon> = {
  library: ListChecksIcon,
  text: TextTIcon,
  textarea: TextAlignLeftIcon,
  select: RadioButtonIcon,
  multiselect: ListChecksIcon,
  checkbox: CheckSquareIcon,
  birth_year: CalendarIcon,
  date: CalendarIcon,
  number: HashIcon,
  phone: PhoneIcon,
  file: PaperclipIcon,
  images: ImagesIcon,
  university: GraduationCapIcon,
  degree: GraduationCapIcon,
  city: MapPinIcon,
};

/** Kinds where the applicant types free text, so a custom placeholder is
 *  meaningful (choice/date/file/university kinds have their own UI instead). */
export const TYPED_KINDS = new Set<FieldKind>(["text", "textarea", "number", "phone"]);

export function FieldKindIcon({ kind, className }: { kind: FieldKind; className?: string }) {
  const Icon = FIELD_KIND_ICON[kind];
  return <Icon className={className} aria-hidden="true" />;
}

/** Choosing the answer format before creating the field avoids a blank,
 * generic question card and makes the next configuration step self-evident. */
export function AddFieldMenu({
  projectMode = false,
  onSelect,
  size = "default",
  variant = "default",
  className,
}: {
  /** The project form also offers photo lists (H16). */
  projectMode?: boolean;
  onSelect: (kind: FieldKind) => void;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "ghost";
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size={size} variant={variant} className={className}>
          <PlusIcon aria-hidden="true" />
          {t("addField")}
          <CaretDownIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(projectMode ? PROJECT_BUILDER_FIELD_KINDS : BUILDER_FIELD_KINDS).map((kind) => (
          <DropdownMenuItem key={kind} onSelect={() => onSelect(kind)}>
            <FieldKindIcon kind={kind} className="text-muted-foreground size-4" />
            {fieldKindLabel(kind, t)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
