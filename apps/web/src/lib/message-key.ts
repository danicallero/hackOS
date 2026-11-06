import type commonEn from "@hackos/shared/locales/en/common.json";
import type webEn from "@hackos/shared/locales/en/web.json";

export type MessageKey = keyof typeof webEn | keyof typeof commonEn;
