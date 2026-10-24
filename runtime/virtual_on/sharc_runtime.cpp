// SPDX-License-Identifier: BSD-3-Clause
// SHARC architectural behavior derived from MAME sharc.cpp/sharcinternal.ipp
// (Ville Linde). Plain memory and callbacks replace the MAME device framework.
#include "sharc.h"

namespace von {
Sharc::Sharc() : storage(std::make_unique<sharc_internal_state>()), m_core(storage.get()),
    blocks{std::vector<uint32_t>(0x8000), std::vector<uint32_t>(0x8000)} { reset(); }
Sharc::~Sharc() = default;
void Sharc::reset() {
    *m_core = {};
    for (auto &block : blocks) std::fill(block.begin(), block.end(), 0);
    auto &s = *m_core;
    s.dma[6] = {0xa1, 0x20000, 1, 0x100, 0, 0, 0x400000, 1, 0x600};
    s.pc = 0x20004; s.daddr = 0x20005; s.faddr = 0x20006; s.nfaddr = 0x20007;
    s.stky = PCEM | SSEM | LSEM; s.imask = 3;
    s.pcstk = 0xffffff; s.curlcntr = 0xffffffff; s.laddr.unpack(0xffffffff);
    s.syscon = 0x10;
    cycles = instructions = 0; iop_deadline = UINT64_MAX; short_signed = false;
}
void Sharc::set_flag_input(unsigned flag, bool value) {
    if (flag >= 4 || BIT(m_core->mode2, flag+15)) fatalerror("SHARC flag %u is not an input", flag);
    m_core->flag[flag] = value;
}
void Sharc::run_compiled(uint32_t instruction_pc) {
    // Hardware-loop processing can change PC before executing the instruction
    // fetched at the loop endpoint. Dispatch by the saved fetch address.
    const uint32_t index = instruction_pc - 0x20000;
    if (index >= program_size || program[index].word != m_core->opcode)
        fatalerror("Uncompiled or modified SHARC instruction at %08x: %012llx (expected %012llx)", instruction_pc,
            (unsigned long long)m_core->opcode, (unsigned long long)(index < program_size ? program[index].word : 0));
    program[index].run(*this);
}
void Sharc::step(bool oracle) {
#ifndef VON_TEST_ORACLE
    if (oracle) fatalerror("SHARC interpreter is not linked");
#endif
    m_core->icount = 1;
    if (m_core->irq_pending) { check_interrupts(); m_core->idle = 0; }
    if (!m_core->write_stalled) {
        if (!m_core->idle) { execute_instruction(oracle); ++instructions; }
        else { dma_run_cycle(6); dma_run_cycle(7); }
    }
    m_core->icount = 0;
    finish_cycle();
}
void Sharc::sharc_iop_delayed_w(uint32_t reg, uint32_t data, int delay) {
    m_core->iop_delayed_reg = reg; m_core->iop_delayed_data = data;
    iop_deadline = cycles + delay;
}
void Sharc::finish_cycle() {
    ++cycles;
    if (cycles >= iop_deadline) {
        iop_deadline = UINT64_MAX;
        const auto reg = m_core->iop_delayed_reg;
        if (reg != 0x1c && reg != 0x1d) fatalerror("Unknown delayed SHARC register %x", reg);
        if (m_core->iop_delayed_data & 1) sharc_dma_exec(reg == 0x1c ? 6 : 7);
    }
}
bool Sharc::waiting_for_input() const {
    const auto &s = *m_core;
    // IF FLAG0 JUMP to self, absolute or relative (without delayed/loop-abort/
    // interrupt-clear bits), and the one-NOP hardware loop.
    const bool direct = s.opcode == (0x061200000000ull | s.pc) || s.opcode == 0x071200000000ull;
    const bool loop = s.laddr.code == 0x19 && s.laddr.loop_type == 0 &&
        !(s.stky & LSEM) && s.pc == s.laddr.addr && s.pc == s.pcstk && s.opcode == 0;
    // Check the whole pipeline so yielding cannot skip a branch/delay slot.
    return s.flag[0] && (direct || loop) &&
        s.daddr == s.pc && s.faddr == s.pc+1 && s.nfaddr == s.pc+2 &&
        !s.dma_status && !s.systemreg_latency_cycles && !s.irq_pending && iop_deadline == UINT64_MAX &&
        s.astat_old == s.astat && s.astat_old_old == s.astat && s.astat_old_old_old == s.astat;
}
uint64_t Sharc::pm_read48(uint32_t address) {
    if (address < 0x20000 || address >= 0x40000 || (address & 0x7fff) >= 0x5000)
        fatalerror("Unmapped SHARC PM read %08x", address);
    const auto &block = blocks[address < 0x28000 ? 0 : 1];
    const uint32_t offset = address & 0x7fff, slot = offset >> 12;
    const uint32_t base = (offset & 0xfff) + (slot >> 1) * 0x3000;
    if (slot & 1) return (uint64_t(block[base+0x2000]) << 16) | (block[base+0x1000] & 0xffff);
    return (uint64_t(block[base]) << 16) | (block[base+0x1000] >> 16);
}
void Sharc::pm_write_masked(uint32_t address, uint64_t value, uint64_t mask) {
    if (address < 0x20000 || address >= 0x40000 || (address & 0x7fff) >= 0x5000)
        fatalerror("Unmapped SHARC PM write %08x", address);
    auto &block = blocks[address < 0x28000 ? 0 : 1];
    const uint32_t offset = address & 0x7fff, slot = offset >> 12;
    const uint32_t base = (offset & 0xfff) + (slot >> 1) * 0x3000;
    const uint32_t high = base + ((slot & 1) ? 0x2000 : 0);
    block[high] = (block[high] & ~uint32_t(mask >> 16)) | uint32_t((value & mask) >> 16);
    const unsigned shift = (slot & 1) ? 0 : 16;
    const uint32_t lowmask = uint32_t(mask & 0xffff) << shift;
    block[base+0x1000] = (block[base+0x1000] & ~lowmask) | (uint32_t(value & mask & 0xffff) << shift);
}
uint32_t Sharc::pm_read32(uint32_t a) { return uint32_t(pm_read48(a) >> 16); }
void Sharc::pm_write32(uint32_t a, uint32_t v) { pm_write_masked(a, uint64_t(v) << 16, 0xffffffff0000ull); }
void Sharc::pm_write48(uint32_t a, uint64_t v) { pm_write_masked(a, v); }
uint32_t Sharc::dm_read32(uint32_t a) {
    if (a < 0x100) return iop_r(a);
    if (a >= 0x20000 && a < 0x40000) return blocks[a < 0x28000 ? 0 : 1][a & 0x7fff];
    if (a >= 0x40000 && a < 0x80000) {
        uint16_t v = blocks[a < 0x50000 ? 0 : 1][(a & 0xffff) >> 1] >> ((a & 1) ? 16 : 0);
        return short_signed ? uint32_t(int32_t(int16_t(v))) : v;
    }
    if (external_read) return external_read(a);
    fatalerror("Unconnected SHARC DM read %08x", a);
}
void Sharc::dm_write32(uint32_t a, uint32_t v) {
    if (a < 0x100) { iop_w(a, v); return; }
    if (a >= 0x20000 && a < 0x40000) { blocks[a < 0x28000 ? 0 : 1][a & 0x7fff] = v; return; }
    if (a >= 0x40000 && a < 0x80000) {
        auto &word = blocks[a < 0x50000 ? 0 : 1][(a & 0xffff) >> 1];
        const unsigned shift = (a & 1) ? 16 : 0;
        word = (word & ~(0xffffu << shift)) | ((v & 0xffff) << shift); return;
    }
    if (external_write) { external_write(a, v); return; }
    fatalerror("Unconnected SHARC DM write %08x", a);
}
std::vector<uint32_t> Sharc::snapshot() const {
    const auto &s = *m_core;
    std::vector<uint32_t> out;
    auto put = [&](auto v) { out.push_back(uint32_t(v)); };
    auto wide = [&](uint64_t v) { put(v); put(v >> 32); };
    for (auto &r : s.r) put(r.r);
    for (auto &r : s.reg_alt) put(r.r);
    put(s.pc); wide(s.mrf); wide(s.mrb);
    for (auto v : s.pcstack) put(v);
    for (auto v : s.lcstack) put(v);
    for (auto v : s.lastack) put(v);
    for (auto v : {s.lstkp, s.faddr, s.daddr, s.pcstk, s.pcstkp, s.laddr.pack(), s.curlcntr,
                  s.lcntr, uint32_t(s.extdma_shift), s.iop_write_num, s.iop_data}) put(v);
    for (const auto *dag : {&s.dag1, &s.dag2, &s.dag1_alt, &s.dag2_alt}) {
        for (auto v : dag->i) put(v); for (auto v : dag->m) put(v);
        for (auto v : dag->b) put(v); for (auto v : dag->l) put(v);
    }
    for (auto &d : s.dma) for (auto v : {d.control, d.int_index, d.int_modifier, d.int_count,
        d.chain_ptr, d.gen_purpose, d.ext_index, d.ext_modifier, d.ext_count}) put(v);
    for (auto v : {s.mode1, s.mode2, s.astat, s.stky, s.irptl, s.imask, s.imaskp, s.ustat1, s.ustat2}) put(v);
    for (auto v : s.flag) put(v);
    put(s.syscon); put(s.sysstat);
    for (auto &v : s.status_stack) { put(v.mode1); put(v.astat); }
    put(s.status_stkp); wide(s.px); wide(s.opcode); put(s.nfaddr);
    put(s.idle); put(s.irq_pending); put(s.active_irq_num);
    for (auto &d : s.dma_op) {
        put(d.src); put(d.dst); put(d.chain_ptr); put(d.src_modifier); put(d.dst_modifier);
        put(d.src_count); put(d.dst_count); put(d.pmode); put(d.chained_direction); put(d.active); put(d.chained);
    }
    put(s.dma_status); put(s.write_stalled); put(s.interrupt_active);
    put(s.iop_delayed_reg); put(s.iop_delayed_data); put(s.delay_slot1); put(s.delay_slot2);
    put(s.systemreg_latency_cycles); put(s.systemreg_latency_reg); put(s.systemreg_latency_data);
    put(s.systemreg_previous_data); put(s.astat_old); put(s.astat_old_old); put(s.astat_old_old_old);
    return out;
}
uint64_t Sharc::memory_hash() const {
    uint64_t hash = 14695981039346656037ull;
    for (const auto &block : blocks) for (auto v : block) for (unsigned i = 0; i < 4; ++i)
        hash = (hash ^ uint8_t(v >> (i*8))) * 1099511628211ull;
    return hash;
}
} // namespace von
