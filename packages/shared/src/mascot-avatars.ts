/** Original HackUDC artwork, in a fixed catalog shared by both clients (#934, H55). */
export const MASCOT_AVATARS = [
  "emilia-original",
  "emilia-center",
  "emilia-left",
  "emilia-right",
  "emilia-close",
  "emilia-top",
  "emilia-peek",
  "emilia-step-center",
  "emilia-step-left",
  "emilia-step-right",
  "emilia-step-close",
  "emilia-step-top",
  "emilia-step-peek",
  "crab-center",
  "crab-left",
  "crab-right",
  "crab-close",
  "crab-top",
  "crab-peek",
  "shrimp-center",
  "shrimp-left",
  "shrimp-right",
  "shrimp-close",
  "shrimp-top",
  "shrimp-peek",
  "shell-center",
  "shell-left",
  "shell-right",
  "shell-close",
  "shell-top",
  "shell-peek",
] as const;

export const MASCOT_BACKGROUNDS = [
  "#a8d8ff",
  "#f8c89e",
  "#c9b9ef",
  "#a9d8bd",
  "#f2d37d",
  "#e8b6c8",
] as const;

/** Repeatable random choices; never reroll on mount or send identity to an image service (#934). */
export function mascotAvatarChoice(userId: string | number | null | undefined, name = "") {
  const identity =
    userId == null
      ? `name:${name.trim().normalize("NFC").toLocaleLowerCase("en")}`
      : `user:${userId}`;
  function hash(salt: string) {
    const seed = `${salt}:${identity}`;
    let value = 2166136261;
    for (let i = 0; i < seed.length; i += 1)
      value = Math.imul(value ^ seed.charCodeAt(i), 16777619);
    return value >>> 0;
  }
  return {
    index: hash("art") % MASCOT_AVATARS.length,
    background: MASCOT_BACKGROUNDS[hash("ground") % MASCOT_BACKGROUNDS.length]!,
  };
}
