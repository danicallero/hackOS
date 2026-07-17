(() => {
  const key = "hackos-language";
  const supported = new Set(["es", "gl", "en"]);
  const normalize = (value) => {
    const language = typeof value === "string" ? value.toLowerCase().split("-")[0] : "";
    return supported.has(language) ? language : null;
  };

  const cookieValue = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${key}=`))
    ?.slice(key.length + 1);
  let language = normalize(cookieValue);

  if (!language) {
    try {
      language = normalize(localStorage.getItem(key));
    } catch {
      // Storage can be unavailable in private mode.
    }
  }

  if (!language) {
    const browserLanguages = Array.isArray(navigator.languages)
      ? navigator.languages
      : [navigator.language];
    language = browserLanguages.map(normalize).find(Boolean) ?? "es";
  }

  window.__hackosInitialLanguage = language;
  try {
    localStorage.setItem(key, language);
  } catch {
    // The root-scoped cookie remains the durable fallback.
  }
  // biome-ignore lint/suspicious/noDocumentCookie: SSR-independent bootstrap persists the preference.
  document.cookie = `${key}=${language}; Path=/; Max-Age=31536000; SameSite=Lax`;
})();
