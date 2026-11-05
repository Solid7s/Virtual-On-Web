// SPDX-License-Identifier: BSD-3-Clause
import { displayGeometry, DISPLAY_MODES } from './display.js';
import { fullscreenVertex, polygonVertex, polygonFragment, layerFragment, tileFragment } from './webgl-shaders.js';

export function createWebGLRenderer(canvas, onFailure) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: true, stencil: false,
    preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) throw Error('WebGL 2 is unavailable. Try a browser with hardware acceleration enabled.');
  let disposed = false;
  const lost = event => { event.preventDefault(); if (!disposed) onFailure('WebGL graphics were interrupted. Reload the page to try again.'); };
  canvas.addEventListener('webglcontextlost', lost);
  const textures = [], programs = [], arrays = [], buffers = [], framebuffers = [];
  const makeProgram = (vertexSource, fragmentSource) => {
    const shaders = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
        const shader = gl.createShader(type); shaders.push(shader);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error('WebGL shader: ' + gl.getShaderInfoLog(shader));
      }
      const program = gl.createProgram(); programs.push(program);
      shaders.forEach(shader => gl.attachShader(program, shader)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('WebGL program: ' + gl.getProgramInfoLog(program));
      return program;
    } finally { shaders.forEach(shader => gl.deleteShader(shader)); }
  };
  const destroy = () => {
    if (disposed) return;
    disposed = true; canvas.removeEventListener('webglcontextlost', lost);
    textures.forEach(t => gl.deleteTexture(t)); programs.forEach(p => gl.deleteProgram(p));
    arrays.forEach(a => gl.deleteVertexArray(a)); buffers.forEach(b => gl.deleteBuffer(b));
    framebuffers.forEach(f => gl.deleteFramebuffer(f));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
  try {
    const poly = makeProgram(polygonVertex, polygonFragment);
    const layer = makeProgram(fullscreenVertex, layerFragment);
    const tile = makeProgram(fullscreenVertex, tileFragment);
    const uniforms = (program, names) => Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
    const pu = uniforms(poly, ['sourceSize','view','outputSize','lodBias','texram','lumaram','xlat']);
    const lu = uniforms(layer, ['sourceSize','outputSize','viewWidth','background','scene','image']);
    const tu = uniforms(tile, ['tiles','characters','pens']);
    const texture = (width, height, integer = true) => {
      const t = gl.createTexture(); textures.push(t); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texStorage2D(gl.TEXTURE_2D, 1, integer ? gl.R32UI : gl.RGBA8, width, height);
      return t;
    };
    const texram = texture(1024,1024), luma = texture(1024,32), xlat = texture(1024,24);
    const tileTextures = [16,128,4].map(height => texture(1024,height));
    const back = texture(496,384,false), front = texture(496,384,false);
    const tileFBO = gl.createFramebuffer(); framebuffers.push(tileFBO);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tileFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,back,0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,front,0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('WebGL cannot create the game layers.');
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    const vertexBuffer = gl.createBuffer(); buffers.push(vertexBuffer);
    const polyVAO = gl.createVertexArray(); arrays.push(polyVAO); gl.bindVertexArray(polyVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);
    for (const [slot,size,offset] of [[0,2,0],[1,1,8],[2,3,12],[3,4,24]]) {
      gl.enableVertexAttribArray(slot); gl.vertexAttribPointer(slot,size,gl.FLOAT,false,64,offset);
    }
    for (const [slot,size,offset] of [[4,4,40],[5,2,56]]) {
      gl.enableVertexAttribArray(slot); gl.vertexAttribIPointer(slot,size,gl.UNSIGNED_INT,64,offset);
    }
    const fullVAO = gl.createVertexArray(); arrays.push(fullVAO); gl.bindVertexArray(fullVAO);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.DITHER);
    gl.useProgram(poly); gl.uniform1i(pu.texram,0); gl.uniform1i(pu.lumaram,1); gl.uniform1i(pu.xlat,2);
    gl.useProgram(layer); gl.uniform1i(lu.image,0);
    gl.useProgram(tile); gl.uniform1i(tu.tiles,0); gl.uniform1i(tu.characters,1); gl.uniform1i(tu.pens,2);
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const stats = { backend:'WebGL 2 accelerated', adapter:gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
      frames:0, polygons:0, textureUploads:0, tileUploads:0, tileCompositions:0, layerUploads:0 };
    const bind = (unit, value) => { gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,value); };
    let mode = 'classic', geometry, margin = -1, textureGeneration = -1, vertexCapacity = 0;
    let tileGenerations = [-1,-1,-1], lookupGenerations = [-1,-1];
    const maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    if (gl.getError() !== gl.NO_ERROR) throw Error('WebGL could not allocate the game renderer.');
    return {
      stats,
      setDisplayMode(value) { if (!DISPLAY_MODES.includes(value)) throw Error('Invalid display mode'); mode=value; },
      prepare(Module) {
        const bounds = canvas.parentElement.getBoundingClientRect();
        geometry=displayGeometry(bounds,mode,globalThis.devicePixelRatio || 1,maxSize);
        canvas.style.width=`${geometry.cssWidth}px`; canvas.style.height=`${geometry.cssHeight}px`;
        if(margin!==geometry.margin){Module._model2_webgpu_margin?.(geometry.margin);margin=geometry.margin;}
      },
      draw(Module, pointer) {
        if(disposed)return;
        const mem=Module.HEAPU8;
        const packet=new Uint32Array(mem.buffer,pointer,32);
        if(packet[0]!==5 || packet[1]!==496 || packet[2]!==384 || packet[4]>32768*18) throw Error('Unsupported WebGL game frame.');
        this.prepare(Module);
        const {width:ow,height:oh,viewWidth}=geometry;
        if(canvas.width!==ow || canvas.height!==oh){canvas.width=ow;canvas.height=oh;}
        const count=packet[4], offset=packet[16]-(viewWidth-496)/2;
        let compose=false;
        for(const [i,rows] of [16,128,4].entries()) {
          if(tileGenerations[i]===packet[27+i] && !Module.model2ForceLayerUpload)continue;
          bind(i,tileTextures[i]);
          gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1024,rows,gl.RED_INTEGER,gl.UNSIGNED_INT,new Uint32Array(mem.buffer,packet[24+i],1024*rows));
          tileGenerations[i]=packet[27+i];compose=true;stats.tileUploads++;
        }
        if(compose){
          gl.bindFramebuffer(gl.FRAMEBUFFER,tileFBO);gl.viewport(0,0,496,384);
          gl.disable(gl.SCISSOR_TEST);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);
          gl.useProgram(tile);gl.bindVertexArray(fullVAO);tileTextures.forEach((t,i)=>bind(i,t));gl.drawArrays(gl.TRIANGLES,0,3);
          stats.tileCompositions++;
        }
        if(count && (textureGeneration!==packet[15] || Module.model2ForceTextureUpload)){
          bind(0,texram);
          for(let i=0;i<2;i++)gl.texSubImage2D(gl.TEXTURE_2D,0,0,i*512,1024,512,gl.RED_INTEGER,gl.UNSIGNED_INT,new Uint32Array(mem.buffer,packet[9+i],0x80000));
          textureGeneration=packet[15];stats.textureUploads++;
        }
        for(const [i,texture] of [luma,xlat].entries()){
          if(lookupGenerations[i]===packet[20+i] && !Module.model2ForceLayerUpload)continue;
          const rows=i===0?32:24;bind(i+1,texture);
          gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1024,rows,gl.RED_INTEGER,gl.UNSIGNED_INT,new Uint32Array(mem.buffer,packet[11+i],1024*rows));
          lookupGenerations[i]=packet[20+i];
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,ow,oh);gl.disable(gl.SCISSOR_TEST);
        gl.depthMask(true);gl.clearColor(0,0,0,1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.bindVertexArray(fullVAO);gl.useProgram(layer);
        gl.uniform2f(lu.sourceSize,496,384);gl.uniform2f(lu.outputSize,ow,oh);gl.uniform1f(lu.viewWidth,viewWidth);
        gl.uniform1i(lu.scene,packet[22]>0);gl.uniform1i(lu.background,1);bind(0,back);gl.drawArrays(gl.TRIANGLES,0,3);
        let draws=0;
        if(count){
          gl.useProgram(poly);gl.bindVertexArray(polyVAO);gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);
          const bytes=count*64;
          if(bytes>vertexCapacity){vertexCapacity=Math.ceil(bytes/65536)*65536;gl.bufferData(gl.ARRAY_BUFFER,vertexCapacity,gl.DYNAMIC_DRAW);}
          gl.bufferSubData(gl.ARRAY_BUFFER,0,mem.subarray(packet[3],packet[3]+bytes));
          gl.uniform2f(pu.sourceSize,496,384);gl.uniform2f(pu.view,offset,viewWidth);gl.uniform2f(pu.outputSize,ow,oh);
          gl.uniform1i(pu.lodBias,Math.round(128*Math.log2(Math.max(1,oh/384))));
          bind(0,texram);bind(1,luma);bind(2,xlat);
          gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.depthFunc(gl.LESS);gl.enable(gl.SCISSOR_TEST);
          const batches=new Uint32Array(mem.buffer,packet[5],packet[6]*6);
          for(let n=0;n<batches.length;n+=6){
            const x=Math.max(0,Math.floor((batches[n+2]-offset)*ow/viewWidth));
            const y=Math.max(0,Math.floor(batches[n+3]*oh/384));
            const right=Math.min(ow,Math.ceil((batches[n+2]+batches[n+4]-offset)*ow/viewWidth));
            const bottom=Math.min(oh,Math.ceil((batches[n+3]+batches[n+5])*oh/384));
            if(right<=x || bottom<=y)continue;
            gl.scissor(x,oh-bottom,right-x,bottom-y);gl.drawArrays(gl.TRIANGLES,batches[n],batches[n+1]);draws++;
          }
        }
        gl.disable(gl.SCISSOR_TEST);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);
        gl.useProgram(layer);gl.bindVertexArray(fullVAO);gl.uniform1i(lu.background,0);bind(0,front);gl.drawArrays(gl.TRIANGLES,0,3);
        Object.assign(stats,{frames:stats.frames+1,polygons:packet[14],vertices:count,drawCalls:draws,
          resolution:`${ow}×${oh}`,displayMode:mode,gpuTiles:true});
      },
      readPixels() {
        const width=canvas.width,height=canvas.height,data=new Uint8Array(width*height*4),flipped=new Uint8Array(data.length);
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);
        for(let y=0;y<height;y++)flipped.set(data.subarray(y*width*4,(y+1)*width*4),(height-1-y)*width*4);
        return flipped;
      },
      readLayers() {
        gl.bindFramebuffer(gl.FRAMEBUFFER,tileFBO);
        const data=[0,1].map(i=>{const pixels=new Uint8Array(496*384*4);gl.readBuffer(gl.COLOR_ATTACHMENT0+i);gl.readPixels(0,0,496,384,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;});
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);return data;
      },
      getError() { return gl.getError(); },
      destroy,
    };
  } catch(error) { destroy(); throw error; }
}
