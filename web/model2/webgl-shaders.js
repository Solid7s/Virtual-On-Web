// SPDX-License-Identifier: BSD-3-Clause
// GLSL ES 3.00 versions of the existing Model 2 and System 24 WGSL shaders.
const header = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
`;
export const fullscreenVertex = header + `
void main() {
  vec2 p = gl_VertexID == 0 ? vec2(-1,-1) : gl_VertexID == 1 ? vec2(3,-1) : vec2(-1,3);
  gl_Position = vec4(p,0,1);
}`;
export const polygonVertex = header + `
layout(location=0) in vec2 position;
layout(location=1) in float depth;
layout(location=2) in vec3 reciprocal;
layout(location=3) in vec4 color;
layout(location=4) in uvec4 info;
layout(location=5) in uvec2 more;
uniform vec2 sourceSize;
uniform vec2 view;
out vec3 vReciprocal;
flat out vec4 vColor;
flat out uvec4 vInfo;
flat out uvec2 vMore;
void main() {
  gl_Position = vec4((position.x-view.x)/view.y*2.0-1.0,1.0-position.y/sourceSize.y*2.0,depth*2.0-1.0,1.0);
  vReciprocal=reciprocal; vColor=color; vInfo=info; vMore=more;
}`;
export const polygonFragment = header + `
uniform usampler2D texram;
uniform usampler2D lumaram;
uniform usampler2D xlat;
uniform vec2 outputSize;
uniform int lodBias;
in vec3 vReciprocal;
flat in vec4 vColor;
flat in uvec4 vInfo;
flat in uvec2 vMore;
out vec4 result;
uint readWord(usampler2D source, uint index) {
  return texelFetch(source,ivec2(int(index&1023u),int(index>>10u)),0).r;
}
const uint logTable[128]=uint[128](0u,2u,5u,8u,11u,14u,16u,19u,22u,25u,27u,30u,33u,35u,38u,40u,43u,46u,48u,51u,53u,56u,58u,61u,63u,65u,68u,70u,73u,75u,77u,80u,82u,84u,87u,89u,91u,93u,96u,98u,100u,102u,104u,106u,109u,111u,113u,115u,117u,119u,121u,123u,125u,127u,129u,132u,134u,136u,138u,140u,141u,143u,145u,147u,149u,151u,153u,155u,157u,159u,161u,162u,164u,166u,168u,170u,172u,173u,175u,177u,179u,181u,182u,184u,186u,188u,189u,191u,193u,194u,196u,198u,200u,201u,203u,205u,206u,208u,209u,211u,213u,214u,216u,218u,219u,221u,222u,224u,225u,227u,229u,230u,232u,233u,235u,236u,238u,239u,241u,242u,244u,245u,247u,248u,250u,251u,253u,254u);
int fastLog2(float value) {
  if(value<0.0)return 0;
  uint iv=floatBitsToUint(value)>>16u;
  return ((int(iv>>7u)-127)<<8)|int(logTable[iv&127u]);
}
int toS32(float value) {
  if(!(value>=-2147483648.0 && value<2147483648.0))return int(0x80000000u);
  return int(value);
}
uint lerp8(uint x,uint y,uint a){return (x+(((y-x)*a)>>8u))&0x00ff00ffu;}
uint getTexel(uint bx,uint by,int x,int y,uint sheet) {
  int x2=int(bx)+x, y2=int(by)+y;
  if(x2>=1024){x2-=1024;y2^=1024;}
  uint off=uint((y2/2)*512+(x2/2));
  uint t=readWord(texram,sheet*0x80000u+((off>>1u)&0x7ffffu));
  if((off&1u)!=0u)t>>=16u;
  if((y&1)==0)t>>=8u;
  if((x&1)==0)t>>=4u;
  return t&15u;
}
uint fetchTexel(uvec4 info,int level,int uin,int vin,bool trans) {
  uint flags=info.x; bool swap=((flags>>10u)&1u)!=0u;
  int u=uin,v=vin;
  uint tw,th,tx,ty,sheet;
  if(level==-1){
    tw=128u;th=128u;tx=info.z&65535u;ty=info.z>>16u;
    sheet=swap?0u:1u;
    uint sh=1u<<((flags>>8u)&3u);u<<=sh;v<<=sh;
  }else{
    tw=(32u<<((flags>>17u)&7u))>>uint(level);
    th=(32u<<((flags>>20u)&7u))>>uint(level);
    tx=(((info.y&65535u)-2048u)>>uint(level))&2047u;
    ty=(((info.y>>16u)-1024u)>>uint(level))&1023u;
    sheet=(((level&1)!=0)!=swap)?1u:0u;
    u>>=uint(level);v>>=uint(level);
  }
  if(((flags>>5u)&1u)!=0u && (u&int(tw<<8u))!=0)u=~u;
  if(((flags>>6u)&1u)!=0u && (v&int(th<<8u))!=0)v=~v;
  u-=128;v-=128;
  uint uf=uint(u)&255u,vf=uint(v)&255u;
  int u0=int(uint(u>>8)&(tw-1u)),u1=int(uint(u0+1)&(tw-1u));
  int v0=int(uint(v>>8)&(th-1u)),v1=int(uint(v0+1)&(th-1u));
  if(((flags>>3u)&1u)==0u && u1==0){
    if(uf>=128u){u0=u1;u1++;uf=0u;}else{u1=u0;u0--;uf=256u;}
  }
  if(((flags>>4u)&1u)==0u && v1==0){
    if(vf>=128u){v0=0;v1++;vf=0u;}else{v1=v0;v0--;vf=256u;}
  }
  uint t00=getTexel(tx,ty,u0,v0,sheet)<<4u;
  uint t01=getTexel(tx,ty,u1,v0,sheet)<<4u;
  uint t10=getTexel(tx,ty,u0,v1,sheet)<<4u;
  uint t11=getTexel(tx,ty,u1,v1,sheet)<<4u;
  if(trans){
    if(t00!=240u)t00|=0x00800000u;if(t01!=240u)t01|=0x00800000u;
    if(t10!=240u)t10|=0x00800000u;if(t11!=240u)t11|=0x00800000u;
    if(t00==240u)t00=t01&255u;if(t01==240u)t01=t00&255u;
    if(t10==240u)t10=t11&255u;if(t11==240u)t11=t10&255u;
  }
  uint t0=lerp8(t00,t01,uf),t1=lerp8(t10,t11,uf);
  if(trans){if(t0==240u)t0=t1&255u;if(t1==240u)t1=t0&255u;}
  return lerp8(t0,t1,vf);
}
void main() {
  uint flags=vInfo.x;
  if(((flags>>2u)&1u)!=0u){uvec2 p=uvec2(gl_FragCoord.x,outputSize.y-gl_FragCoord.y);if(((p.x^p.y)&1u)==0u)discard;}
  uint renderer=flags&3u;
  if(renderer<2u){result=vColor;return;}
  bool trans=renderer==3u;int maxlevel=int((flags>>12u)&31u);
  float z=1.0/vReciprocal.x;
  int mml=-(int(vMore.x)+lodBias)+fastLog2(z);
  int level=clamp(mml>>7,0,maxlevel);
  int u=toS32(vReciprocal.y*z*256.0),v=toS32(vReciprocal.z*z*256.0);
  uint t=fetchTexel(vInfo,level,u,v,trans);
  if(mml>0 && level<maxlevel)t=lerp8(t,fetchTexel(vInfo,level+1,u,v,trans),uint((mml&127)<<1));
  else if(((flags>>7u)&1u)!=0u && mml<0)t=lerp8(t,fetchTexel(vInfo,-1,u,v,trans),uint(min((-mml)>>((flags>>8u)&3u),127)));
  if(trans){if(t<0x00400000u)discard;t&=255u;}
  uint lb=vInfo.w&65535u,pl=vInfo.w>>16u;
  uint luma=min(((readWord(lumaram,lb+(t>>1u))&255u)*pl/256u)&255u,63u)+((vMore.y&65536u)!=0u?128u:0u);
  uint c=vMore.y;
  result=vec4(float(readWord(xlat,((c&31u)<<8u)+luma)),float(readWord(xlat,0x2000u+(((c>>5u)&31u)<<8u)+luma)),float(readWord(xlat,0x4000u+(((c>>10u)&31u)<<8u)+luma)),255.0)/255.0;
}`;
export const layerFragment = header + `
uniform sampler2D image;
uniform vec2 sourceSize;
uniform vec2 outputSize;
uniform float viewWidth;
uniform bool background;
uniform bool scene;
out vec4 result;
void main(){
  vec2 p=vec2(gl_FragCoord.x,outputSize.y-gl_FragCoord.y);
  vec2 at=vec2(p.x/outputSize.x*viewWidth+(sourceSize.x-viewWidth)/2.0,p.y/outputSize.y*sourceSize.y);
  vec4 c;
  if(background && viewWidth>sourceSize.x && scene){
    vec2 source=p/outputSize*sourceSize;
    float x=clamp(source.x-0.5,0.0,sourceSize.x-1.0);
    vec4 a=texelFetch(image,ivec2(int(floor(x)),int(source.y)),0);
    vec4 b=texelFetch(image,ivec2(min(int(floor(x))+1,int(sourceSize.x)-1),int(source.y)),0);
    c=mix(a,b,fract(x));
  }else{
    if(background && viewWidth>sourceSize.x)at.x=clamp(at.x,0.0,sourceSize.x-1.0);
    if(any(lessThan(at,vec2(0))) || any(greaterThanEqual(at,sourceSize)))discard;
    c=texelFetch(image,clamp(ivec2(at),ivec2(0),ivec2(sourceSize)-1),0);
  }
  if(all(equal(c,vec4(0))))discard;
  result=vec4(c.bgr,1);
}`;
export const tileFragment = header + `
uniform usampler2D tiles;
uniform usampler2D characters;
uniform usampler2D pens;
layout(location=0) out vec4 background;
layout(location=1) out vec4 foreground;
uint wordAt(usampler2D source,uint index){return texelFetch(source,ivec2(int(index&1023u),int(index>>10u)),0).r;}
uint tile(uint index){return (wordAt(tiles,index>>1u)>>((index&1u)*16u))&65535u;}
uint layerPixel(uint layer,uint category,uvec2 at){
  uint hscroll=tile(0x5000u+layer),vscroll=tile(0x5004u+layer);
  if((vscroll&0x8000u)!=0u)return 0u;
  uint mode=(tile(0x5004u+(layer&2u))>>13u)&3u;
  uint sourceLayer=layer;
  bool opaque=category==0u && layer>=2u;
  if((hscroll&0x8000u)!=0u)hscroll=tile(0x4000u+0x200u*layer+at.y);
  if(mode!=0u){
    if((layer&1u)!=0u)return 0u;
    if(mode==1u){uint split=0u-vscroll;sourceLayer^=(split&0x200u)==0u?1u:0u;sourceLayer^=at.y>=(split&511u)?1u:0u;}
    else{sourceLayer^=(hscroll&0x200u)==0u?1u:0u;sourceLayer^=at.x>=(hscroll&511u)?1u:0u;}
  }else{
    uint maskBase=layer>=2u?0x6800u:0x6000u;
    uint mask=tile(maskBase+at.y*4u+(at.x>>7u));
    if((layer&1u)!=0u)mask=~mask;
    if((mask&(0x8000u>>((at.x&127u)>>3u)))!=0u)return 0u;
  }
  uvec2 source=uvec2(at.x-(hscroll&511u),at.y+vscroll)&uvec2(511u);
  uint value=tile(sourceLayer*4096u+(source.y>>3u)*64u+(source.x>>3u));
  uint address=((value&0x3fffu)*32u+(source.y&7u)*4u+((source.x&7u)>>1u))^1u;
  uint byteValue=(wordAt(characters,address>>2u)>>((address&3u)*8u))&255u;
  uint pixel=(byteValue>>((source.x&1u)!=0u?0u:4u))&15u;
  if((!opaque || mode!=0u) && (value>>15u)!=category)return 0u;
  if(!opaque && pixel==0u)return 0u;
  return wordAt(pens,((value>>7u)&255u)*16u+pixel);
}
vec4 unpackBytes(uint value){return vec4(float(value&255u),float((value>>8u)&255u),float((value>>16u)&255u),float(value>>24u))/255.0;}
void main(){
  uvec2 at=uvec2(gl_FragCoord.xy);
  uint back=wordAt(pens,0u),front=0u;
  for(int layer=3;layer>=0;layer--){
    uint b=layerPixel(uint(layer),0u,at),f=layerPixel(uint(layer),1u,at);
    if(b!=0u)back=b;if(f!=0u)front=f;
  }
  background=unpackBytes(back);foreground=unpackBytes(front);
}`;
