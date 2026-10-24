// SPDX-License-Identifier: BSD-3-Clause
// Standalone execution boundary: no machine, device, scheduler or interpreter.
#include "i960.h"
#ifdef VON_REGISTER_BLOCKS
#include "frame_runtime.h"
#endif
#include <algorithm>

namespace von {
#ifdef VON_REGISTER_BLOCKS
unsigned I960::run_register_block(uint64_t budget) {
    if (!blocks_enabled || m_stall_state.burst_mode || m_immediate_irq ||
        m_IP >= 0x200000 || (m_IP & 3)) return 0;
    const auto *entry = dispatch[m_IP >> 2];
    const auto *block = entry ? entry->block : nullptr;
    // Strictly before every event: no device can observe intermediate state,
    // and these whitelisted instructions cannot access memory or trigger IRQs.
    if (!block || block->ticks >= budget) return 0;
    return execute_register_block(*block);
}

unsigned I960::execute_register_block(const Block &block) {
    m_stalled = false;
    block.run(*this);
    m_IP += block.count * 4;
    m_PIP = m_IP - 4;
    instructions += block.count;
    block_instructions += block.count;
    cycles += block.ticks;
    return block.ticks;
}

unsigned I960::step(FrameRuntime *frames, uint64_t next_sound) {
#else
unsigned I960::step() {
#endif
    if (!program) throw std::runtime_error("Initialize the compiled program before stepping");
    // Like the reference, interrupts must wait for a stalled burst to finish.
    m_icount = 0;
    if (!m_stall_state.burst_mode) check_immediate_irqs();
    const Entry *entry = nullptr;
    if (m_IP < 0x200000 && !(m_IP & 3)) entry = dispatch[m_IP >> 2];
    else {
        const auto first = std::lower_bound(program, program + program_size, m_IP,
            [](const Entry &e, uint32_t pc) { return e.pc < pc; });
        if (first != program + program_size && first->pc == m_IP) {
            const uint32_t actual = bus.read_dword(m_IP);
            for (auto p = first; p != program + program_size && p->pc == m_IP; ++p)
                if (p->word == actual) { entry = p; break; }
        }
    }
    if (!entry) fatalerror("No compiled instruction at %08x", m_IP);
#ifdef VON_REGISTER_BLOCKS
    if (frames && blocks_enabled && entry->block && !m_stall_state.burst_mode && !m_immediate_irq && !m_icount) {
        const uint64_t deadline = std::min({frames->next_vblank, frames->board.next_event(),
            frames->copro.uart ? frames->copro.uart->next_event() : UINT64_MAX, next_sound});
        const auto now = frames->board.now();
        if (deadline > now && entry->block->ticks < deadline - now)
            return execute_register_block(*entry->block);
    }
#endif
    m_PIP = m_IP; m_IP += 4; m_stalled = false;
    if (m_stall_state.burst_mode) execute_burst_stall_op(entry->word);
    else entry->run(*this);
    ++instructions;
    const unsigned used = unsigned(-m_icount);
    cycles += used;
    return used;
}

#ifdef VON_TEST_ORACLE
unsigned I960::oracle_step() {
    m_icount = 0;
    if (!m_stall_state.burst_mode) check_immediate_irqs();
    m_PIP = m_IP;
    const uint32_t word = bus.read_dword(m_IP);
    m_IP += 4; m_stalled = false;
    if (m_stall_state.burst_mode) execute_burst_stall_op(word);
    else oracle_op(word);
    ++instructions;
    const unsigned used = unsigned(-m_icount);
    cycles += used;
    return used;
}
#endif

std::vector<uint32_t> I960::snapshot() const {
    std::vector<uint32_t> result;
    result.reserve(160);
    result.insert(result.end(), std::begin(m_r), std::end(m_r));
    for (const auto &frame : m_rcache) result.insert(result.end(), std::begin(frame), std::end(frame));
    result.insert(result.end(), std::begin(m_rcache_frame_addr), std::end(m_rcache_frame_addr));
    for (double fp : m_fp) { auto bits = d2u(fp); result.push_back(uint32_t(bits)); result.push_back(uint32_t(bits >> 32)); }
    for (uint32_t v : {m_SAT, m_PRCB, m_PC, m_AC, m_IP, m_PIP, m_ICR,
        uint32_t(m_rcache_pos), uint32_t(m_immediate_irq), uint32_t(m_immediate_vector),
        uint32_t(m_immediate_pri), uint32_t(m_stalled), m_stall_state.t1, m_stall_state.t2,
        uint32_t(m_stall_state.index), uint32_t(m_stall_state.size), uint32_t(m_stall_state.burst_mode),
        uint32_t(m_stall_state.iswriteop), uint32_t(m_icount)}) result.push_back(v);
    for (auto line : m_irq_line_state) result.push_back(uint32_t(line));
    return result;
}
} // namespace von
