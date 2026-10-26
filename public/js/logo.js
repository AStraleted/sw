/* Знак SQULED: плитка-суперэллипс, линия «S» и бирюзовая точка.
   state: "" | "idle" (точка дышит) | "thinking" (по S бежит световой след) | "draw" (прорисовка при появлении) */
const S_PATH = "M18.4 9.6h-6.3a3.2 3.2 0 0 0 0 6.4h5.4a3.2 3.2 0 0 1 0 6.4H9.2";
const TILE = "M16 0C27.2 0 32 4.8 32 16S27.2 32 16 32 0 27.2 0 16 4.8 0 16 0z";

export function mark(size = 28, state = "") {
  return `<span class="mark ${state}" style="width:${size}px;height:${size}px"><svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">` +
    `<path class="m-tile" d="${TILE}"/>` +
    `<path class="m-s" d="${S_PATH}" pathLength="100"/>` +
    `<path class="m-trail" d="${S_PATH}" pathLength="100"/>` +
    `<circle class="m-dot" cx="22.2" cy="9.6" r="1.75"/></svg></span>`;
}

export function wordmark(size = 24) {
  return `<span class="wordmark">${mark(size)}<b>SQULED</b><span>Studio</span></span>`;
}
