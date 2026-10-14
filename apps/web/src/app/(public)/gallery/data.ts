import commonEn from "@hackos/shared/locales/en/common.json";
import en from "@hackos/shared/locales/en/web.json";
import commonEs from "@hackos/shared/locales/es/common.json";
import es from "@hackos/shared/locales/es/web.json";
import commonGl from "@hackos/shared/locales/gl/common.json";
import gl from "@hackos/shared/locales/gl/web.json";
import { cookies } from "next/headers";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import type { MessageKey, Translate } from "@/lib/i18n";
import { isLanguage, LANGUAGE_PREFERENCE_KEY } from "@/lib/locale";
import type { NativeProject } from "@/lib/native-projects";

export async function galleryContext() {
  const jar = await cookies();
  const preference = jar.get(LANGUAGE_PREFERENCE_KEY)?.value;
  const language = isLanguage(preference) ? preference : "es";
  const copy = { en, es, gl }[language];
  const common = { en: commonEn, es: commonEs, gl: commonGl }[language] as Record<string, string>;
  // Server pages cannot use the client i18n module; apiErrorText only needs flat key lookup.
  const t: Translate = (key: MessageKey) =>
    (copy as Record<string, string>)[key] ?? common[key] ?? key;
  return {
    language,
    copy,
    t,
    options: {
      cache: "no-store" as const,
      credentials: "include" as const,
      headers: { cookie: jar.toString() },
    },
  };
}
/** H17/H60: every render and metadata read re-evaluates the API audience/reveal policy. */
export async function galleryProject(id: string) {
  const context = await galleryContext();
  const project = await api.get<NativeProject>(
    `/api/public/projects/${encodeURIComponent(id)}`,
    context.options,
  );
  return { ...context, project };
}

export function projectAssetUrl(path: string) {
  return new URL(path, API_URL).toString();
}
