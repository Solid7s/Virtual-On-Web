// SPDX-License-Identifier: BSD-3-Clause
// Exact specialization of the profiled six-term polynomial tail. Included in
// the generated SHARC translation unit so the existing float/flag helpers inline.
namespace von {
unsigned Sharc::run_polynomial() {
    auto &s = *m_core;
    const unsigned count = s.curlcntr;
    if (s.daddr != 0x20dd8 || s.faddr != 0x20dd9 || s.nfaddr != 0x20dda ||
        s.laddr.addr != 0x20dd9 || s.laddr.loop_type != 2 || s.laddr.code != 15 ||
        s.pcstk != 0x20dd8 || (s.stky & LSEM) || !count || count > 6 ||
        !s.lstkp || s.lstkp > 6 || !s.pcstkp || s.pcstkp > 30 ||
        s.idle || s.write_stalled || s.irq_pending || s.dma_status ||
        s.systemreg_latency_cycles || iop_deadline != UINT64_MAX || s.dag1.l[7]) return 0;
    const uint32_t address = s.dag1.i[7];
    // Only plain internal SRAM; no FIFO, host callbacks, short-word conversion,
    // circular wrapping, or DMA that could observe intermediate instructions.
    if (address < 0x20000 || address >= 0x40000 ||
        (address & 0x7fff) + count > 0x8000) return 0;
    const auto first = program[0xdd8].word, second = program[0xdd9].word;
    if (pm_read48(0x20dd8) != first || pm_read48(0x20dd9) != second) return 0;
    const auto *coefficients = blocks[address < 0x28000 ? 0 : 1].data() + (address & 0x7fff);
    auto history = [&] {
        s.astat_old_old_old = s.astat_old_old;
        s.astat_old_old = s.astat_old;
        s.astat_old = s.astat;
    };
    // Separate single-precision operations, never FMA or a replacement libm
    // approximation. These helpers also preserve denormals, NaNs and sticky flags.
    for (unsigned i = 0; i < count; ++i) {
        history(); compute_fmul(4, 12, 4);
        s.r[2].r = coefficients[i]; ++s.dag1.i[7];
        history(); --s.curlcntr;
        if (i + 1 == count) { POP_LOOP(); POP_PC(); }
        compute_fadd(4, 2, 4);
    }
    s.pc = 0x20dd9; s.daddr = 0x20dda; s.faddr = 0x20ddb; s.nfaddr = 0x20ddc;
    s.opcode = second; s.icount = 0;
    const unsigned executed = count * 2;
    instructions += executed; cycles += executed; polynomial_instructions += executed;
#ifdef VON_SHARC_PROFILE
    pc_counts[0xdd8] += count; pc_counts[0xdd9] += count;
#endif
    return executed;
}
} // namespace von
