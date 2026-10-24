// Compare real GPU output against fixtures from the independent CPU compositor.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'build/tile-fixtures');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || 'http://localhost:8084/');
    await page.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      const device = await adapter.requestDevice();
      const errors = [];
      device.addEventListener('uncapturederror', e => errors.push(e.error.message));
      const shader = device.createShaderModule({ code: await (await fetch('/web/model2/system24.wgsl')).text() });
      const compilation = await shader.getCompilationInfo();
      if (compilation.messages.some(m => m.type === 'error')) throw Error(JSON.stringify(compilation.messages));
      const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: shader, entryPoint: 'compose' } });
      const buffers = [0x10000, 0x80000, 0x4000].map(size => device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
      const textures = [0, 1].map(() => device.createTexture({ size: [496, 384], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC }));
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        ...buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
        ...textures.map((texture, i) => ({ binding: 3+i, resource: texture.createView() }))] });
      window.checkFixture = async index => {
        const data = new Uint8Array(await (await fetch(`/build/tile-fixtures/${index}.dat`)).arrayBuffer());
        let offset = 0;
        for (const [i, size] of [0x10000, 0x80000, 0x4000].entries()) {
          device.queue.writeBuffer(buffers[i], 0, data.subarray(offset, offset+size)); offset += size;
        }
        const size = 2048*384, read = device.createBuffer({ size: size*2, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(62, 48); pass.end();
        textures.forEach((texture, i) => encoder.copyTextureToBuffer({ texture }, { buffer: read, offset: i*size, bytesPerRow: 2048 }, [496, 384]));
        device.queue.submit([encoder.finish()]); await read.mapAsync(GPUMapMode.READ);
        const actual = new Uint32Array(read.getMappedRange());
        const expected = new Uint32Array(data.buffer, offset);
        const mismatches = [];
        for (let layer=0; layer<2; ++layer) {
          let count=0, first;
          for (let y=0; y<384; ++y) for (let x=0; x<496; ++x) {
            const a=actual[layer*512*384+y*512+x], b=expected[layer*496*384+y*496+x];
            if (a!==b) { count++; first ||= { x, y, actual:a.toString(16), expected:b.toString(16) }; }
          }
          mismatches.push({ layer, count, first });
        }
        read.destroy(); return { index, mismatches, errors };
      };
    });
    const records = [];
    for (const file of fs.readdirSync(directory).filter(f => f.endsWith('.dat')).sort((a,b)=>parseInt(a)-parseInt(b))) {
      const record = await page.evaluate(i => checkFixture(i), parseInt(file)); records.push(record);
      assert.deepEqual(record.errors, []);
      assert.equal(record.mismatches.reduce((sum, layer) => sum + layer.count, 0), 0, JSON.stringify(record));
    }
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(records, null, 2));
    console.log(`All ${records.length} GPU tile fixtures exactly match the CPU compositor (${records.length*496*384*2} pixels).`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
