/**
 * What an SVG logo offers the hero tint (H44): the platform image decoders
 * read rasters only, so an SVG either hands over the largest raster it embeds
 * (a `data:image/...;base64` image, as design tools export), or its paint
 * colours as pixels, one per fill or stroke, for `pickDominantColor`.
 */
export type SvgTintSource =
  | { kind: "raster"; bytes: Uint8Array }
  | { kind: "paint"; rgba: Uint8Array };

export function isSvg(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 512)).trimStart();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
}

function base64Bytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexColor(value: string): [number, number, number] | null {
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [0, 1, 2].map((i) => Number.parseInt(hex.charAt(i).repeat(2), 16)) as [
      number,
      number,
      number,
    ];
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

export function svgTintSource(svg: string): SvgTintSource | null {
  let raster: string | null = null;
  for (const match of svg.matchAll(/data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)/g)) {
    const data = match[1] as string;
    if (!raster || data.length > raster.length) raster = data;
  }
  if (raster) return { kind: "raster", bytes: base64Bytes(raster) };
  const colors: number[] = [];
  for (const match of svg.matchAll(
    /(?:fill|stroke|stop-color)\s*(?:=\s*["']|:\s*)(#[0-9a-f]{3,6}\b|rgba?\([^)]*\))/gi,
  )) {
    const color = hexColor(match[1] as string);
    if (color) colors.push(...color, 255);
  }
  return colors.length ? { kind: "paint", rgba: Uint8Array.from(colors) } : null;
}
