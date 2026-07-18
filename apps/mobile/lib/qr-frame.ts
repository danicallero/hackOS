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

export interface QrFrameObservation {
  areaRatio: number;
  centerX: number;
  centerY: number;
}

// Make the operator bring one QR deliberately into the foreground: a square QR
// must occupy about 39% of the frame in each direction before it can scan.
const MIN_BARCODE_TO_FRAME_AREA_RATIO = 0.15;

export function isBarcodeScannableInFrame(
  barcode: BarcodeGeometry,
  viewport: { height: number; width: number },
  frameSize: number,
): boolean {
  return getBarcodeFrameObservation(barcode, viewport, frameSize) !== null;
}

export function getBarcodeFrameObservation(
  barcode: BarcodeGeometry,
  viewport: { height: number; width: number },
  frameSize: number,
): QrFrameObservation | null {
  if (viewport.width <= 0 || viewport.height <= 0 || frameSize <= 0) return null;

  const points =
    barcode.cornerPoints.length >= 4 ? barcode.cornerPoints : pointsFromBounds(barcode);
  if (points.length === 0) return null;

  const left = (viewport.width - frameSize) / 2;
  const right = left + frameSize;
  const top = (viewport.height - frameSize) / 2;
  const bottom = top + frameSize;

  const isInsideFrame = points.every(
    (point) => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom,
  );
  if (!isInsideFrame) return null;

  const orderedPoints = orderPoints(points);
  if (!isPointInsidePolygon({ x: viewport.width / 2, y: viewport.height / 2 }, orderedPoints)) {
    return null;
  }

  const barcodeArea =
    barcode.cornerPoints.length >= 4
      ? polygonArea(orderedPoints)
      : barcode.bounds.size.width * barcode.bounds.size.height;

  const areaRatio = barcodeArea / (frameSize * frameSize);
  if (areaRatio < MIN_BARCODE_TO_FRAME_AREA_RATIO) return null;

  const center = points.reduce(
    (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
  return {
    areaRatio,
    centerX: (center.x - viewport.width / 2) / frameSize,
    centerY: (center.y - viewport.height / 2) / frameSize,
  };
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

function orderPoints(points: Point[]): Point[] {
  const center = points.reduce(
    (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
  return [...points].sort(
    (a, b) =>
      Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x),
  );
}

function polygonArea(points: Point[]): number {
  return Math.abs(
    points.reduce((area, point, index) => {
      const next = points[(index + 1) % points.length];
      return area + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
}

function isPointInsidePolygon(point: Point, polygon: Point[]): boolean {
  let direction = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const cross = (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
    if (Math.abs(cross) < Number.EPSILON) continue;

    const edgeDirection = Math.sign(cross);
    if (direction !== 0 && edgeDirection !== direction) return false;
    direction = edgeDirection;
  }
  return direction !== 0;
}
