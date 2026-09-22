import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/lib/i18n";

export function ExportSensitivityBadge() {
  const { t } = useLocale();

  return (
    <Badge variant="outline" className="text-muted-foreground">
      {t("exportContainsPii")}
    </Badge>
  );
}
