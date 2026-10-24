// Instruction-frequency capture, deliberately excluded from performance builds.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const m = await require(root+'/build/v3-standalone/player-wasm-sharc-profile/virtual-on-standalone.cjs')({ noInitialRun: true });
  m.FS.mkdir('/game');
  for (const f of ['vonu','vonj','main-data','copro-data','polygons','textures','sound-program','samples'])
    m.FS.writeFile('/game/'+f+'.bin', fs.readFileSync(root+'/build/v3-standalone/'+f+'.bin'));
  const records=[];
  for (const japan of [0,1]) {
    assert.equal(m.ccall('von_init','number',['string','number'],['/game',japan]),1); m._von_draw(0);
    let previous = Array(3679).fill(0);
    for (let n=0;n<4000;n++) {
      const input0=(n>=1200&&n<1218)||(n>=1236&&n<1254)?0xfe:n>=1272&&n<1290?0xef:0xff;
      let sticks=0xff;
      if(n>=1428&&n<1446)sticks=0xfe;
      if(n>=2100){if(n%30<20)sticks&=~1;if(n%120<(japan?30:60))sticks&=~32;}
      m._von_input(0,input0);m._von_input(1,sticks);m._von_input(2,n>=2100?sticks:0xff);
      assert.equal(m._von_frame(),1,m.UTF8ToString(m._von_error()));
      if ([1199,2063,3999].includes(n)) {
        const counts = JSON.parse(m.UTF8ToString(m._von_sharc_profile()));
        const delta = counts.map((v,i)=>v-previous[i]); previous=counts;
        const record={region:japan?'Japan':'USA',frame:n+1,counts:delta}; records.push(record);
        console.log(JSON.stringify({region:record.region,frame:record.frame,total:delta.reduce((a,b)=>a+b,0),top:delta.map((count,i)=>({pc:(0x20000+i).toString(16),count})).sort((a,b)=>b.count-a.count).slice(0,25)}));
      }
    }
  }
  fs.writeFileSync(root+'/build/sharc-profile-45.json',JSON.stringify(records));
})().catch(e=>{ console.error(e); process.exitCode=1; });
