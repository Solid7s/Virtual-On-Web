// Specialized math versus the independent instruction decoder, including flags,
// loop-stack restoration, SRAM, cycles, and exceptional floating-point inputs.
#include "sharc.h"
#include <iostream>
#include <random>
using von::Sharc;
void require(bool yes, const char *message) { if (!yes) throw std::runtime_error(message); }
int main() {
 try {
  Sharc fast, oracle; std::mt19937 random(0x504f4c59);
  for (unsigned i=0;i<Sharc::program_size;++i)fast.pm_write48(0x20000+i,Sharc::program[i].word);
  const uint32_t specials[]={0,0x80000000,1,0x80000001,0x7f800000,0xff800000,0x7fc12345,0x7f812345,0x7f7fffff,0x00800000,0x3f800000};
  for(unsigned trial=0;trial<6000;++trial){
   auto &s=*fast.m_core;
   s={};s.daddr=0x20dd8;s.faddr=0x20dd9;s.nfaddr=0x20dda;s.pc=0x20dd7;
   s.pcstk=0x20dd8;s.pcstkp=1+trial%4;s.lstkp=1+trial%3;
   s.laddr.addr=0x20dd9;s.laddr.loop_type=2;s.laddr.code=15;s.curlcntr=1+trial%6;
   s.astat=random();s.astat_old=random();s.astat_old_old=random();s.astat_old_old_old=random();
   s.stky=random()&~Sharc::LSEM;s.mode1=random();s.lcntr=random();
   for(auto &v:s.pcstack)v=random();for(auto &v:s.lcstack)v=random();for(auto &v:s.lastack)v=random();
   for(auto &v:s.r)v.r=random();
   if(trial%2){s.r[4].r=specials[trial%11];s.r[12].r=specials[(trial/11)%11];}
   s.dag1.i[7]=0x30100;for(unsigned i=0;i<6;i++)fast.dm_write32(0x30100+i,trial%3?random():specials[(trial+i)%11]);
   fast.cycles=123;fast.instructions=456;fast.iop_deadline=UINT64_MAX;
   *oracle.m_core=s;oracle.blocks=fast.blocks;oracle.cycles=fast.cycles;oracle.instructions=fast.instructions;
   const auto count=s.curlcntr*2;require(fast.run_polynomial()==count,"Specialization not exercised");
   for(unsigned i=0;i<count;i++)oracle.step(true);
   require(fast.snapshot()==oracle.snapshot(),"Architectural state differs");
   require(fast.blocks==oracle.blocks,"SRAM differs");
   require(fast.cycles==oracle.cycles&&fast.instructions==oracle.instructions,"Timing differs");
  }
  // Start from a valid entry, then independently invalidate every guard family.
  auto &s=*fast.m_core;s={};s.daddr=0x20dd8;s.faddr=0x20dd9;s.nfaddr=0x20dda;
  s.laddr.addr=0x20dd9;s.laddr.loop_type=2;s.laddr.code=15;s.pcstk=0x20dd8;
  s.pcstkp=s.lstkp=1;s.curlcntr=6;s.dag1.i[7]=0x30100;
  const auto entry=s;
  for(unsigned bad=0;bad<19;bad++){
   s=entry;fast.iop_deadline=UINT64_MAX;
   switch(bad){
    case 0:s.irq_pending=1;break;case 1:s.dma_status=64;break;case 2:s.systemreg_latency_cycles=1;break;
    case 3:fast.iop_deadline=fast.cycles+30;break;case 4:s.idle=1;break;case 5:s.write_stalled=1;break;
    case 6:s.dag1.l[7]=8;break;case 7:s.dag1.i[7]=0x400000;break;case 8:s.dag1.i[7]=0x27ffe;break;
    case 9:s.faddr++;break;case 10:s.nfaddr++;break;case 11:s.curlcntr=0;break;case 12:s.curlcntr=7;break;
    case 13:s.laddr.loop_type=0;break;case 14:s.stky|=Sharc::LSEM;break;case 15:s.lstkp=0;break;
    case 16:s.pcstkp=0;break;case 17:s.pcstk++;break;case 18:fast.pm_write48(0x20dd8,0);break;
   }
   const auto before=fast.snapshot(), cycles=std::vector<uint32_t>{uint32_t(fast.cycles),uint32_t(fast.instructions)};
   require(fast.run_polynomial()==0,"Unsafe entry accepted");require(before==fast.snapshot(),"Rejected entry mutated state");
   require(cycles[0]==fast.cycles&&cycles[1]==fast.instructions,"Rejected entry changed timing");
  }
  std::cout<<"6000 polynomial oracle comparisons and 19 fallback guards passed\n";
 }catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}
}
