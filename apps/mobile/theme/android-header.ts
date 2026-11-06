/** Shared by the Android custom headers (`AndroidDetailHeader`) and the text beside them. */
export const noTextShadow = {
  textShadowColor: "transparent" as const,
  textShadowOffset: { height: 0, width: 0 },
  textShadowRadius: 0,
};

/** The soft edge under a drawn Android header. */
export const androidHeaderShadow = {
  shadowColor: "#000000",
  shadowOffset: { height: 2, width: 0 },
  shadowOpacity: 0.08,
  shadowRadius: 6,
};
