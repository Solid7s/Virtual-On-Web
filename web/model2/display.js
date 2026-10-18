// Keep the arcade's vertical field of view and pixel aspect. Wider windows
// expose extra columns; portrait windows retain the complete 4:3 picture.
export const DISPLAY_MODES = ['classic', 'enhanced', 'enhanced-plus'];

export function displayGeometry(bounds, mode, dpr = 1, limit = 8192) {
  const enhanced = mode !== 'classic';
  const aspect = mode === 'enhanced-plus' ? Math.max(4 / 3, Math.min(32 / 9, bounds.width / Math.max(1, bounds.height))) : 4 / 3;
  const cssWidth = Math.max(1, Math.min(bounds.width, bounds.height * aspect));
  const cssHeight = cssWidth / aspect;
  const scale = Math.min(dpr, limit / Math.max(cssWidth, cssHeight));
  const width = enhanced ? Math.max(1, Math.round(cssWidth * scale)) : 496;
  const height = enhanced ? Math.max(1, Math.round(cssHeight * scale)) : 384;
  const viewWidth = 496 * aspect / (4 / 3);
  return { cssWidth, cssHeight, width, height, viewWidth,
    margin: Math.max(0, Math.ceil((viewWidth - 496) / 2)), aspect };
}
