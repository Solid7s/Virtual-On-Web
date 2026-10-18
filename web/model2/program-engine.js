// Only these two programs have V3 translations. Other sets retain their normal core.
export async function programEngine(game, search, available) {
  const fallback = { base: '../../engines/mame/', compiled: false };
  if (!['vonu', 'vonj'].includes(game) || new URLSearchParams(search).get('virtualOnAot') === '0') return fallback;
  const base = '../../engines/virtual-on/';
  try {
    if ((await Promise.all(['model2.js', 'model2.wasm'].map(name => available(base + name)))).every(Boolean))
      return { base, compiled: true };
  } catch { /* A checkout without local generated assets keeps the general core. */ }
  return fallback;
}
