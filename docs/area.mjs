import { boundary } from "./boundary.mjs";

export function assessPoint(longitude, latitude) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return "review";
  const scaleX = 111320 * Math.cos(latitude * Math.PI / 180);
  const scaleY = 111320;
  let inside = false;
  let distance = Infinity;
  for (let i = 1; i < boundary.length; i++) {
    const [a, b] = boundary[i - 1];
    const [c, d] = boundary[i];
    if ((b > latitude) !== (d > latitude)
      && longitude < (c - a) * (latitude - b) / (d - b) + a) inside = !inside;
    const x = (a - longitude) * scaleX;
    const y = (b - latitude) * scaleY;
    const dx = (c - a) * scaleX;
    const dy = (d - b) * scaleY;
    const fraction = Math.max(0, Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(x + fraction * dx, y + fraction * dy));
  }
  if (distance <= 20) return "review";
  return inside ? "inside" : "outside";
}
