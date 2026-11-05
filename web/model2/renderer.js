import { createGeneralRenderer } from './gpu-renderer.js';
import { createWebGLRenderer } from './webgl-renderer.js';

// Keep the running board and input state when only the graphics backend fails.
export async function createRenderer(canvas, onFailure, { replaceCanvas, onFallback }) {
  let current, backend = 'webgpu', disposed = false, initializing = true, initialFailure;
  let mode = 'enhanced', module;
  function fallback(reason) {
    if (disposed || backend === 'webgl') return;
    backend = 'webgl'; // Ignore late errors from the old WebGPU device.
    try { current?.destroy(); } catch { /* A lost device may already be unusable. */ }
    // A canvas cannot change context type after getContext('webgpu') succeeds.
    canvas = replaceCanvas(canvas);
    try {
      current = createWebGLRenderer(canvas, onFailure);
      current.stats.backend = 'Standalone Virtual-On + WebGL 2';
      current.setDisplayMode(mode);
      if (module) current.prepare(module);
    } catch (error) {
      current?.destroy();
      throw Error(`Graphics unavailable. WebGPU: ${reason}. WebGL 2: ${error.message}`);
    }
    onFallback(reason);
  }
  try {
    current = await createGeneralRenderer(canvas, message => {
      if (disposed || backend !== 'webgpu') return;
      if (initializing) initialFailure = Error(message);
      else {
        try { fallback(message); } catch (error) { onFailure(error.message); }
      }
    });
    if (initialFailure) throw initialFailure;
    current.stats.backend = 'Standalone Virtual-On + WebGPU';
  } catch (error) {
    fallback(error.message);
  } finally { initializing = false; }

  function render(method, ...args) {
    if (disposed) return;
    try { return current[method](...args); }
    catch (error) {
      if (backend !== 'webgpu') throw error;
      fallback(error.message);
      return current[method](...args);
    }
  }
  return {
    get stats() { return current.stats; },
    setDisplayMode(value) { current.setDisplayMode(value); mode = value; },
    prepare(Module) { module = Module; render('prepare', Module); },
    draw(Module, pointer) { module = Module; render('draw', Module, pointer); },
    readLayers() { return current.readLayers(); },
    readPixels() { return current.readPixels?.(); },
    getError() { return current.getError?.() ?? 0; },
    destroy() { disposed = true; current.destroy(); },
  };
}
