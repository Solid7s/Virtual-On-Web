// Differential replay through the first win and next fight in both regions.
// Supply TEST_BASELINE/TEST_CANDIDATE engine directories; extracted ROMs stay in ignored build/.

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
if (!process.env.TEST_BASELINE && !process.env.TEST_REFERENCE) throw Error('Set TEST_BASELINE or TEST_REFERENCE.');
const candidate=path.resolve(process.env.TEST_CANDIDATE || root+'/build/v3-standalone/player-wasm');
const roots=process.env.TEST_REFERENCE ? [candidate] : [path.resolve(process.env.TEST_BASELINE),candidate];
const reference=process.env.TEST_REFERENCE ? new Map(JSON.parse(fs.readFileSync(process.env.TEST_REFERENCE))
 .filter(r=>r.state).map(r=>[`${r.region}:${r.frame}`,r.state])) : null;
const checksums=process.env.TEST_CHECKSUMS !== '0';
if (!checksums && reference) throw Error('Checksum-off validation requires TEST_BASELINE for direct PCM comparison.');
(async()=>{
const modules=[];
for(const engine of roots){
 const m=await require(engine+'/virtual-on-standalone.cjs')({noInitialRun:true});
 m.FS.mkdir('/game');
 for(const f of ['vonu','vonj','main-data','copro-data','polygons','textures','sound-program','samples'])m.FS.writeFile('/game/'+f+'.bin',fs.readFileSync(root+'/build/v3-standalone/'+f+'.bin'));
 modules.push(m);
}
const records=[];
for(const japan of [0,1]){
 for(const [i,m] of modules.entries()){
  assert.equal(m.ccall('von_init','number',['string','number'],['/game',japan]),1);
  if(i===modules.length-1 && !checksums) {
   assert.equal(typeof m._von_audio_checksums,'function','Candidate must support checksum control');
   assert.equal(JSON.parse(m.UTF8ToString(m._von_state())).audio,null,'Default must be disabled');
  } else m._von_audio_checksums?.(1);
  m._von_draw(process.env.TEST_RENDER==='1'?1:0);m._von_gpu(1);m._von_gpu_tiles?.(Number(process.env.TEST_TILES || 0));
 }
 if(process.env.TEST_BLOCKS !== undefined) modules.at(-1)._von_blocks(Number(process.env.TEST_BLOCKS));
 const times=modules.map(()=>0n); let timedFrames=0;
 let nextFight=0,result=0;
 for(let n=0;n<10000;n++){
  const input0=(n>=1200&&n<1218)||(n>=1236&&n<1254)?0xfe:n>=1272&&n<1290?0xef:0xff;
  let sticks=0xff;
  if(n>=1428&&n<1446)sticks=0xfe;
  if(n>=2100){if(n%30<20)sticks&=~1;if(n%120<(japan?30:60))sticks&=~32;}
  for(const [i,m] of modules.entries()){
   m._von_input(0,input0);m._von_input(1,sticks);m._von_input(2,n>=2100?sticks:0xff);
   const start=process.hrtime.bigint();
   if(!m._von_frame())throw Error(m.UTF8ToString(m._von_error()));
   if(n>=2100&&n<3300)times[i]+=process.hrtime.bigint()-start;
  }
  if(!checksums){
   const [baseline,candidate]=modules;
   assert.equal(candidate._von_audio_count(),baseline._von_audio_count());
   const pcm=m=>Buffer.from(m.HEAPU8.buffer,m._von_audio(),m._von_audio_count()*8);
   assert.ok(pcm(candidate).equals(pcm(baseline)),`PCM at region ${japan} frame ${n+1}`);
  }
  if(n>=2100&&n<3300)timedFrames++;
  const m=modules[0],scene=m._von_peek(0x503a00),stage=m._von_peek(0x503a80);
  if(n>2100&&[11,21,12].includes(scene))result=n;
  if(result&&stage>0&&scene===10&&!nextFight)nextFight=n;
  if([1199,1403,2063].includes(n)||n%600===599||nextFight&&n===nextFight+1100){
   const states=modules.map(m=>JSON.parse(m.UTF8ToString(m._von_state())));
   const expected=reference ? reference.get(`${japan?'Japan':'USA'}:${n+1}`) : states[0];
   assert.ok(expected, 'Missing reference checkpoint');
   if(checksums) assert.deepEqual(states.at(-1),expected,`state at ${japan?'Japan':'USA'} frame ${n+1}`);
   else {
    assert.equal(states.at(-1).audio,null);
    assert.equal(typeof expected.audio,'string');
    assert.deepEqual({...states.at(-1),audio:expected.audio},expected,`non-diagnostic state at region ${japan} frame ${n+1}`);
   }
   const rec={region:japan?'Japan':'USA',frame:n+1,stage,scene,state:states[0]};records.push(rec);console.log(JSON.stringify({region:rec.region,frame:n+1,stage,scene,matched:true}));
  }
  if(nextFight&&n>=nextFight+1100)break;
 }
 assert.ok(nextFight,'Must reach the second fight');
 const last=modules.at(-1);
 if(last._von_audio_hashed_frames){
  assert.equal(last._von_audio_hashed_frames(),checksums?last._von_audio_total():0);
  records.push({region:japan?'Japan':'USA',checksums,hashedFrames:last._von_audio_hashed_frames(),
   audioFrames:last._von_audio_total(),pcmComparedEveryFrame:!checksums});
 }
 if(modules.at(-1)._von_block_instructions && process.env.TEST_BLOCKS !== '0') {
  const count=modules.at(-1)._von_block_instructions(); assert.ok(count>100000,'Must exercise compiled blocks');
  records.push({region:japan?'Japan':'USA',blockInstructions:count});
 }
 const timing={region:japan?'Japan':'USA',render:process.env.TEST_RENDER==='1',frames:timedFrames,ms:times.map(t=>Number(t)/1e6),ratio:modules.length===2?Number(times[0])/Number(times[1]):undefined};
 records.push({timing});console.log(JSON.stringify(timing));
 if(modules.at(-1)._von_sharc_math_instructions) {
  const sharcMathInstructions=modules.at(-1)._von_sharc_math_instructions();
  assert.ok(sharcMathInstructions>100000,'Must exercise specialized SHARC math');
  records.push({region:japan?'Japan':'USA',sharcMathInstructions});
  console.log(JSON.stringify({region:japan?'Japan':'USA',sharcMathInstructions}));
 }
 if(modules.at(-1)._von_dsp_info) {
  const dsp=JSON.parse(modules.at(-1).UTF8ToString(modules.at(-1)._von_dsp_info()));
  records.push({region:japan?'Japan':'USA',dsp}); console.log(JSON.stringify({region:japan?'Japan':'USA',dsp}));
 }
}
// A partially collected checksum must never masquerade as a full replay hash.
const m=modules.at(-1),state=()=>JSON.parse(m.UTF8ToString(m._von_state()));
if(m._von_audio_checksums){
 assert.equal(m.ccall('von_init','number',['string','number'],['/game',0]),1);
 assert.equal(state().audio,null);assert.equal(m._von_audio_hashed_frames(),0);
 m._von_audio_checksums(1);assert.equal(m._von_frame(),1);
 const fullHash=state().audio;assert.equal(typeof fullHash,'string');
 m._von_audio_checksums(0);assert.equal(state().audio,null);
 m._von_audio_checksums(1);assert.equal(state().audio,fullHash);
 m._von_audio_checksums(0);assert.equal(m._von_frame(),1);
 m._von_audio_checksums(1);assert.equal(m._von_frame(),1);
 assert.ok(m._von_audio_hashed_frames()<m._von_audio_total());assert.equal(state().audio,null);
 records.push({checksumToggleAndReset:true});
}
fs.writeFileSync(process.env.TEST_OUTPUT || root+'/build/runtime-comparison.json',JSON.stringify(records,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
