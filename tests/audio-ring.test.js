import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioRing } from '../web/model2/audio-ring.js';
const data = (count, start=0) => Float32Array.from({length:count*2}, (_,i)=>start+i);
test('stereo PCM remains exact across wraparound and changing render quanta', () => {
  const ring = new AudioRing(); const expected=[]; let cursor=0;
  for (let block=0;block<200;block++) {
    const samples=data(767,cursor); cursor+=samples.length; expected.push(...samples); ring.push(samples,767);
    if (block<3) continue;
    let remaining=767;
    while(remaining) {
      const count=Math.min(remaining, block%2?128:255), left=new Float32Array(count), right=new Float32Array(count);
      ring.render(left,right);
      for(let i=0;i<count;i++){ assert.equal(left[i],expected.shift()); assert.equal(right[i],expected.shift()); }
      remaining-=count;
    }
  }
  assert.equal(ring.underruns,0); assert.equal(ring.dropped,0);
});
test('starvation is silent and refills before restarting without repeating samples', () => {
  const ring=new AudioRing(), left=new Float32Array(1024), right=new Float32Array(1024);
  ring.push(data(1800),1800); ring.render(left,right); ring.render(left,right);
  assert.equal(left[775],3598); assert.equal(left[776],0); assert.equal(ring.underruns,1);
  ring.push(data(100,9000),100); ring.render(left,right); assert.ok(left.every(v=>v===0));
  ring.push(data(1700,9200),1700); ring.render(left,right);
  assert.equal(left[0],9000); assert.equal(left[100],9200);
});
test('pause clears stale sound and overflow bounds latency', () => {
  const ring=new AudioRing(), left=new Float32Array(128), right=new Float32Array(128);
  ring.push(data(2000),2000);ring.reset();ring.render(left,right);assert.ok(left.every(v=>v===0));
  for(let i=0;i<30;i++)ring.push(data(767,i*2000),767);
  assert.ok(ring.size<=ring.maximum);assert.ok(ring.dropped>0);
  ring.reset();ring.push(data(2000,100000),2000);ring.render(left,right);assert.equal(left[0],100000);
});
test('invalid sample packets cannot corrupt the ring', () => {
  const ring=new AudioRing();for(const frames of [-1,1.2,Infinity,999999])ring.push(data(10),frames);
  assert.equal(ring.size,0);assert.equal(ring.received,0);
});
