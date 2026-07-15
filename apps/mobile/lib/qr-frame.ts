interface Point {
  x: number;
  y: number;
}

interface BarcodeGeometry {
  cornerPoints: Point[];
  bounds: {
    origin: Point;
    size: { height: number; width: number };
  };
}

export function isBarcodeInsideFrame(
  barcode: BarcodeGeometry,
  viewport: { height: number; width: number },
  frameSize: number,
): boolean {
  const points =
    barcode.cornerPoints.length >= 4 ? barcode.cornerPoints : pointsFromBounds(barcode);
  if (points.length === 0) return false;

  const left = (viewport.width - frameSize) / 2;
  const right = left + frameSize;
  const top = (viewport.height - frameSize) / 2;
  const bottom = top + frameSize;

  return points.every(
    (point) => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom,
  );
}

function pointsFromBounds(barcode: BarcodeGeometry): Point[] {
  const { origin, size } = barcode.bounds;
  if (size.width <= 0 || size.height <= 0) return [];
  return [
    origin,
    { x: origin.x + size.width, y: origin.y },
    { x: origin.x + size.width, y: origin.y + size.height },
    { x: origin.x, y: origin.y + size.height },
  ];
}
