const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const errors=[],records=[];
 try {
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:8084/');
  records.push(await page.evaluate(async()=>{
   const context=new OfflineAudioContext(2,4096,44100);
   await context.audioWorklet.addModule('/web/model2/audio-worklet.js');
   const node=new AudioWorkletNode(context,'virtual-on-audio',{numberOfInputs:0,outputChannelCount:[2]});node.connect(context.destination);
   const samples=Float32Array.from({length:8192},(_,i)=>Math.sin(i*.017)*.5),reference=samples.slice();
   await new Promise(resolve=>{node.port.onmessage=()=>resolve();node.port.postMessage({type:'samples',buffer:samples.buffer,frames:4096},[samples.buffer]);});
   const result=await context.startRendering();let mismatches=0;
   for(let i=0;i<4096;i++)for(let c=0;c<2;c++)if(result.getChannelData(c)[i]!==reference[i*2+c])++mismatches;
   node.disconnect();node.port.close();return {test:'actual worklet stereo output',mismatches};
  }));
  assert.equal(records[0].mismatches,0);
  for(const mode of ['worklet','legacy','rate-fallback','load-fallback']){
   const record=await page.evaluate(async mode=>{
    const Native=window.AudioContext;
    if(mode==='rate-fallback')window.AudioContext=class extends Native {constructor(){super({sampleRate:48000});}};
    if(mode==='load-fallback')window.AudioContext=class extends Native {constructor(o){super(o);Object.defineProperty(this.audioWorklet,'addModule',{value:async()=>{throw Error('test unavailable');}});}};
    const {createGameAudio}=await import('/web/model2/game-audio.js');const audio=await createGameAudio({legacy:mode==='legacy'});window.AudioContext=Native;
    await audio.resume();const samples=Float32Array.from({length:1534},(_,i)=>Math.sin(i*.03)*.2);
    const timer=setInterval(()=>audio.push(samples),17.384);await new Promise(r=>setTimeout(r,1400));clearInterval(timer);
    const stats={...audio.stats};await audio.suspend();const stopped=audio.context.currentTime;
    await new Promise(r=>setTimeout(r,80));const frozen=audio.context.currentTime===stopped;
    await audio.resume();audio.push(samples);await audio.close();await audio.close();
    return {mode,stats,frozen,closed:audio.context.state};
   },mode);
   assert.equal(record.frozen,true);assert.equal(record.closed,'closed');
   assert.equal(record.stats.mode,mode==='worklet'?'worklet':'buffer-source');
   if(mode==='worklet'){assert.ok(record.stats.played>30000);assert.equal(record.stats.sources,0);assert.equal(record.stats.poolMisses,0);assert.equal(record.stats.buffers,16);}
   else assert.ok(record.stats.sources>50);
   records.push(record);
  }
  assert.deepEqual(errors,[]);fs.writeFileSync('build/audio-45.json',JSON.stringify({records,errors},null,2));console.log(JSON.stringify(records));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
