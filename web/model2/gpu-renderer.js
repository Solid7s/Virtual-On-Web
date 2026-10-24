// BSD-3-Clause. Adapted directly from Daytona-USA-Web/renderer.js.
// Shared 64-byte polygon format, Model 2 texture shader and layered GPU passes.
// ABI 5 adds raw System 24 snapshots from the standalone Virtual-On runtime.
import { displayGeometry, DISPLAY_MODES } from './display.js';
const layerShader = `
@group(0) @binding(0) var image: texture_2d<f32>;
struct Screen { size: vec2f, output: vec2f, lod: vec2f, view: vec2f }
@group(0) @binding(1) var<uniform> screen: Screen;
@vertex fn vs(@builtin(vertex_index) id:u32)->@builtin(position) vec4f {
 let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
 return vec4f(p[id],0,1);
}
fn sample_layer(atf:vec2f)->vec4f {
 if(any(atf<vec2f(0)) || any(atf>=screen.size)){discard;}
 let at=vec2i(atf);
 let c=textureLoad(image,clamp(at,vec2i(0),vec2i(textureDimensions(image))-vec2i(1)),0);
 if(all(c==vec4f(0))){discard;}
 return vec4f(c.bgr,1);
}
fn centered(p:vec2f)->vec2f {
 return vec2f(p.x/screen.output.x*screen.view.y+(screen.size.x-screen.view.y)/2.0,p.y/screen.output.y*screen.size.y);
}
@fragment fn fs_back(@builtin(position) p:vec4f)->@location(0) vec4f {
 let at=centered(p.xy);
 if(screen.view.y<=screen.size.x){return sample_layer(at);}
 // Extend edge colors on menus; stretch only a substantial 3D scene.
 if(screen.lod.y<=0.0){return sample_layer(vec2f(clamp(at.x,0.0,screen.size.x-1.0),at.y));}
 let source=p.xy/screen.output*screen.size;
 let x=clamp(source.x-0.5,0.0,screen.size.x-1.0);
 let a=textureLoad(image,vec2i(i32(floor(x)),i32(source.y)),0);
 let b=textureLoad(image,vec2i(min(i32(floor(x))+1,i32(screen.size.x)-1),i32(source.y)),0);
 let c=mix(a,b,fract(x));
 if(all(c==vec4f(0))){discard;}
 return vec4f(c.bgr,1);
}
@fragment fn fs_front(@builtin(position) p:vec4f)->@location(0) vec4f {
 return sample_layer(centered(p.xy));
}`;

export async function createGeneralRenderer(canvas, onFailure) {
  if (!globalThis.isSecureContext || !navigator.gpu) throw Error('WebGPU requires a compatible browser and HTTPS or localhost.');
  // Fullscreen high-DPI shading can overwhelm a laptop's integrated GPU.
  // This is a preference; single-GPU browsers still choose their own adapter.
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    || await navigator.gpu.requestAdapter();
  if (!adapter) throw Error('No WebGPU adapter is available.');
  const device = await adapter.requestDevice();
  let disposed = false;
  device.lost.then(info => { if (!disposed) onFailure('WebGPU device lost: ' + info.message); });
  device.addEventListener('uncapturederror', event => onFailure('WebGPU: ' + event.error.message));
  const context = canvas.getContext('webgpu');
  if (!context) { disposed = true; device.destroy(); throw Error('Could not create a WebGPU canvas.'); }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const response = await fetch(new URL('./model2-enhanced.wgsl', import.meta.url));
  if (!response.ok) { disposed = true; device.destroy(); throw Error('Could not load the Daytona Model 2 shader.'); }
  const modelShader = device.createShaderModule({ label: 'Daytona Model 2 raster rules', code: await response.text() });
  const layerModule = device.createShaderModule({ label: 'System 24 layers', code: layerShader });
  const tileResponse = await fetch(new URL('./system24.wgsl', import.meta.url));
  if (!tileResponse.ok) { disposed = true; device.destroy(); throw Error('Could not load the System 24 shader.'); }
  const tileModule = device.createShaderModule({ label: 'System 24 GPU composition', code: await tileResponse.text() });
  for (const shader of [modelShader, layerModule, tileModule]) {
    const result = await shader.getCompilationInfo();
    const errors = result.messages.filter(message => message.type === 'error');
    if (errors.length) { disposed = true; device.destroy(); throw Error(errors.map(message => `${message.lineNum}: ${message.message}`).join('\n')); }
  }
  const polyPipeline = await device.createRenderPipelineAsync({
    label: 'General Model 2 polygons (Daytona renderer)', layout: 'auto',
    vertex: { module: modelShader, entryPoint: 'vs_poly', buffers: [{ arrayStride: 64, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x2' },
      { shaderLocation: 1, offset: 8, format: 'float32' },
      { shaderLocation: 2, offset: 12, format: 'float32x3' },
      { shaderLocation: 3, offset: 24, format: 'float32x4' },
      { shaderLocation: 4, offset: 40, format: 'uint32x4' },
      { shaderLocation: 5, offset: 56, format: 'uint32x2' }] }] },
    fragment: { module: modelShader, entryPoint: 'ps_poly', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const makeLayerPipeline = entryPoint => device.createRenderPipelineAsync({
    layout: 'auto', vertex: { module: layerModule, entryPoint: 'vs' },
    fragment: { module: layerModule, entryPoint, targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'always' },
  });
  const backPipeline = await makeLayerPipeline('fs_back');
  const frontPipeline = await makeLayerPipeline('fs_front');
  const tilePipeline = await device.createComputePipelineAsync({ label: 'System 24 tile decoding and composition',
    layout: 'auto', compute: { module: tileModule, entryPoint: 'compose' } });
  const buffer = (size, usage) => device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
  const screen = buffer(32, GPUBufferUsage.UNIFORM);
  const texram = buffer(0x400000, GPUBufferUsage.STORAGE);
  const luma = buffer(0x20000, GPUBufferUsage.STORAGE);
  const xlat = buffer(0x6000 * 4, GPUBufferUsage.STORAGE);
  const tileBuffers = [0x10000, 0x80000, 0x4000].map(size => buffer(size, GPUBufferUsage.STORAGE));
  let tileGroup, tileGenerations = [-1, -1, -1], lastGpuTiles = false;
  const polyGroup = device.createBindGroup({ layout: polyPipeline.getBindGroupLayout(0),
    entries: [screen, texram, luma, xlat].map((value, binding) => ({ binding, resource: { buffer: value } })) });
  let vertexBuffer, vertexCapacity = 0, depth, back, front, backGroup, frontGroup;
  let width = 0, height = 0, outputWidth = 0, outputHeight = 0, mode = 'enhanced';
  let geometry, requestedMargin = -1;
  let textureGeneration = -1;
  let layerGenerations = [-1, -1], lookupGenerations = [-1, -1];
  const stats = { backend: 'WebGPU + general Model 2 core', frames: 0, polygonFrames: 0,
    vertices: 0, polygons: 0, drawCalls: 0, textureUploads: 0, textureUploadBytes: 0,
    layerUploads: 0, layerUploadBytes: 0, lookupUploads: 0, lookupUploadBytes: 0,
    tileUploads: 0, tileUploadBytes: 0, tileCompositions: 0,
    adapter: adapter.info?.description || adapter.info?.device
      || [adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(' ') || 'WebGPU' };
  const layerGroup = (texture, pipeline) => device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: texture.createView() }, { binding: 1, resource: { buffer: screen } }] });
  return {
    stats,
    setDisplayMode(value) {
      if (!DISPLAY_MODES.includes(value)) throw Error('Invalid display mode');
      mode = value;
    },
    prepare(Module) {
      geometry = displayGeometry(canvas.parentElement.getBoundingClientRect(), mode,
        globalThis.devicePixelRatio || 1, device.limits.maxTextureDimension2D);
      canvas.style.width = `${geometry.cssWidth}px`; canvas.style.height = `${geometry.cssHeight}px`;
      if (geometry.margin !== requestedMargin) {
        if (!Module._model2_webgpu_margin && mode === 'enhanced-plus') throw Error('Rebuild the engine for Enhanced+ widescreen support.');
        Module._model2_webgpu_margin?.(geometry.margin);
        requestedMargin = geometry.margin;
      }
    },
    draw(Module, packetPointer) {
      if (disposed) return;
      const mem = Module.HEAPU8; // Memory growth can replace the underlying view.
      const packet = new Uint32Array(mem.buffer, packetPointer, 16);
      if (![1, 2, 3, 4, 5].includes(packet[0])) throw Error('Incompatible Model 2 WebGPU frame ABI. Rebuild the engine and reload.');
      const w = packet[1], h = packet[2], count = packet[4];
      if (!w || !h || w > 2048 || h > 2048 || count > 32768 * 18) throw Error('Invalid Model 2 GPU frame.');
      this.prepare(Module);
      const { width: ow, height: oh, viewWidth } = geometry;
      const extra = packet[0] >= 3 ? new Uint32Array(mem.buffer, packetPointer + 64, packet[0] >= 4 ? 8 : 4) : [0, 0];
      const cached = packet[0] >= 4 && !Module.model2ForceLayerUpload;
      const scene = packet[0] >= 4 ? extra[6] : Number(count > 0);
      const gpuTiles = packet[0] === 5;
      if (gpuTiles !== lastGpuTiles) { tileGenerations.fill(-1); layerGenerations.fill(-1); lastGpuTiles = gpuTiles; }
      const margin = extra[0], offset = margin - (viewWidth - w) / 2;
      if (ow !== outputWidth || oh !== outputHeight) {
        depth?.destroy(); outputWidth = ow; outputHeight = oh; canvas.width = ow; canvas.height = oh;
        depth = device.createTexture({ size: [ow, oh], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
      }
      if (w !== width || h !== height) {
        back?.destroy(); front?.destroy(); width = w; height = h;
        const descriptor = { size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
          | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING };
        back = device.createTexture(descriptor); front = device.createTexture(descriptor);
        backGroup = layerGroup(back, backPipeline); frontGroup = layerGroup(front, frontPipeline);
        layerGenerations = [-1, -1];
        tileGenerations.fill(-1);
        tileGroup = device.createBindGroup({ layout: tilePipeline.getBindGroupLayout(0), entries: [
          ...tileBuffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
          { binding: 3, resource: back.createView() }, { binding: 4, resource: front.createView() }] });
      }
      device.queue.writeBuffer(screen, 0, new Float32Array([w, h, ow, oh,
        Math.round(128 * Math.log2(Math.max(1, oh / h))), scene, offset, viewWidth]));
      const view = (pointer, length) => mem.subarray(pointer, pointer + length);
      const uploadLayer = (texture, pointer) => device.queue.writeTexture({ texture }, view(pointer, w * h * 4), { bytesPerRow: w * 4 }, [w, h]);
      let composeTiles = false;
      if (gpuTiles) {
        const tiles = new Uint32Array(mem.buffer, packetPointer + 96, 6);
        for (const [i, bytes] of [0x10000, 0x80000, 0x4000].entries()) {
          if (!cached || tileGenerations[i] !== tiles[3 + i]) {
            device.queue.writeBuffer(tileBuffers[i], 0, view(tiles[i], bytes));
            tileGenerations[i] = tiles[3 + i]; composeTiles = true;
            stats.tileUploads++; stats.tileUploadBytes += bytes;
          }
        }
      } else for (const [i, texture] of [back, front].entries()) {
        if (!cached || layerGenerations[i] !== extra[2 + i]) {
          uploadLayer(texture, packet[7 + i]);
          layerGenerations[i] = extra[2 + i];
          stats.layerUploads++; stats.layerUploadBytes += w * h * 4;
        }
      }
      // Daytona's generation-based upload cache, driven by general hardware
      // write taps and invalidated on state restoration. Diagnostic override
      // permits a direct comparison with unconditional uploads.
      if (count && (packet[0] === 1 || packet[15] !== textureGeneration || Module.model2ForceTextureUpload)) {
        device.queue.writeBuffer(texram, 0, view(packet[9], 0x200000));
        device.queue.writeBuffer(texram, 0x200000, view(packet[10], 0x200000));
        textureGeneration = packet[15];
        stats.textureUploads++; stats.textureUploadBytes += 0x400000;
      }
      for (const [i, [buffer, bytes]] of [[luma, 0x20000], [xlat, 0x6000 * 4]].entries()) {
        if (!cached || lookupGenerations[i] !== extra[4 + i]) {
          device.queue.writeBuffer(buffer, 0, view(packet[11 + i], bytes));
          lookupGenerations[i] = extra[4 + i];
          stats.lookupUploads++; stats.lookupUploadBytes += bytes;
        }
      }
      const size = count * 64;
      if (size > vertexCapacity) {
        vertexBuffer?.destroy(); vertexCapacity = Math.ceil(size / 65536) * 65536;
        vertexBuffer = buffer(vertexCapacity, GPUBufferUsage.VERTEX);
      }
      if (size) device.queue.writeBuffer(vertexBuffer, 0, view(packet[3], size));
      const encoder = device.createCommandEncoder();
      if (composeTiles) {
        const compute = encoder.beginComputePass();
        compute.setPipeline(tilePipeline); compute.setBindGroup(0, tileGroup);
        compute.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8)); compute.end();
        stats.tileCompositions++;
      }
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1 } });
      pass.setPipeline(backPipeline); pass.setBindGroup(0, backGroup); pass.draw(3);
      let draws = 0;
      if (size) {
        pass.setPipeline(polyPipeline); pass.setBindGroup(0, polyGroup); pass.setVertexBuffer(0, vertexBuffer);
        const batches = new Uint32Array(mem.buffer, packet[5], packet[6] * 6);
        for (let n = 0; n < batches.length; n += 6) {
          const x = Math.max(0, Math.floor((batches[n + 2] - offset) * ow / viewWidth));
          const y = Math.max(0, Math.floor(batches[n + 3] * oh / h));
          const right = Math.min(ow, Math.ceil((batches[n + 2] + batches[n + 4] - offset) * ow / viewWidth));
          const bottom = Math.min(oh, Math.ceil((batches[n + 3] + batches[n + 5]) * oh / h));
          if (right <= x || bottom <= y) continue;
          pass.setScissorRect(x, y, right - x, bottom - y);
          pass.draw(batches[n + 1], 1, batches[n]); draws++;
        }
      }
      pass.setScissorRect(0, 0, ow, oh); pass.setPipeline(frontPipeline); pass.setBindGroup(0, frontGroup); pass.draw(3);
      pass.end(); device.queue.submit([encoder.finish()]);
      Object.assign(stats, { frames: stats.frames + 1, polygonFrames: stats.polygonFrames + Number(count > 0),
        vertices: count, polygons: packet[14], drawCalls: draws, resolution: `${ow}×${oh}`,
        sequence: packet[13], textureGeneration: packet[15], displayMode: mode,
        aspect: geometry.aspect, viewWidth, capturedMargin: margin, widenedPolygons: extra[1],
        sceneBackdrop: !!scene, packetABI: packet[0],
        gpuTiles, tileGenerations: [...tileGenerations],
        layerGenerations: [...layerGenerations], lookupGenerations: [...lookupGenerations] });
    },
    // Diagnostic readback only; never used in the gameplay frame loop.
    async readLayers() {
      const row = Math.ceil(width * 4 / 256) * 256, size = row * height;
      const readback = device.createBuffer({ size: size * 2, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        const encoder = device.createCommandEncoder();
        for (const [i, texture] of [back, front].entries())
          encoder.copyTextureToBuffer({ texture }, { buffer: readback, offset: i * size, bytesPerRow: row }, [width, height]);
        device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
        const data = new Uint8Array(readback.getMappedRange());
        return [0, 1].map(i => {
          const pixels = new Uint8Array(width * height * 4);
          for (let y = 0; y < height; ++y) pixels.set(data.subarray(i * size + y * row, i * size + y * row + width * 4), y * width * 4);
          return pixels;
        });
      } finally { readback.destroy(); }
    },
    destroy() {
      disposed = true;
      for (const resource of [depth, back, front, vertexBuffer, screen, texram, luma, xlat, ...tileBuffers]) resource?.destroy();
      context.unconfigure(); device.destroy();
    },
  };
}
