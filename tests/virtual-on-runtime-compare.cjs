// Differential replay through the first win and next fight in both regions.
// Supply TEST_BASELINE/TEST_CANDIDATE engine directories; extracted ROMs stay in ignored build/.

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
if (!process.env.TEST_BASELINE) throw Error('Set TEST_BASELINE to the backed-up player-wasm directory.');
const roots=[path.resolve(process.env.TEST_BASELINE),path.resolve(process.env.TEST_CANDIDATE || root+'/build/v3-standalone/player-wasm')];
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
 for(const m of modules){assert.equal(m.ccall('von_init','number',['string','number'],['/game',japan]),1);m._von_draw(process.env.TEST_RENDER==='1'?1:0);m._von_gpu(1);m._von_gpu_tiles?.(0);}
 const times=[0n,0n]; let timedFrames=0;
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
  if(n>=2100&&n<3300)timedFrames++;
  const m=modules[0],scene=m._von_peek(0x503a00),stage=m._von_peek(0x503a80);
  if(n>2100&&[11,21,12].includes(scene))result=n;
  if(result&&stage>0&&scene===10&&!nextFight)nextFight=n;
  if([1199,1403,2063].includes(n)||n%600===599||nextFight&&n===nextFight+1100){
   const states=modules.map(m=>JSON.parse(m.UTF8ToString(m._von_state())));
   assert.deepEqual(states[1],states[0],`state at ${japan?'Japan':'USA'} frame ${n+1}`);
   const rec={region:japan?'Japan':'USA',frame:n+1,stage,scene,state:states[0]};records.push(rec);console.log(JSON.stringify({region:rec.region,frame:n+1,stage,scene,matched:true}));
  }
  if(nextFight&&n>=nextFight+1100)break;
 }
 assert.ok(nextFight,'Must reach the second fight');
 const timing={region:japan?'Japan':'USA',render:process.env.TEST_RENDER==='1',frames:timedFrames,ms:times.map(t=>Number(t)/1e6),ratio:Number(times[0])/Number(times[1])};
 records.push({timing});console.log(JSON.stringify(timing));
}
fs.writeFileSync(process.env.TEST_OUTPUT || root+'/build/runtime-comparison.json',JSON.stringify(records,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
