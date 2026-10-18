// Browser SHARC interpreter: collapse a one-NOP hardware loop waiting on FLAG.
// Called at the loop endpoint only when its arithmetic termination is FALSE.
// All skipped iterations see the same flag: external changes are scheduled
// between CPU timeslices. Consume only this slice's remaining cycle budget.
#pragma once
#include <cstdint>

template <typename State>
int model2_sharc_wait_cycles(const State &s, uint32_t target, bool debugging)
{
    const unsigned condition = s.laddr.code & 0xf;
    if (debugging || target != s.pc || s.icount <= 1
        || condition < 9 || condition > 12 || s.opcode != 0
        || s.laddr.loop_type != 0 || s.laddr.addr != s.pc
        || (s.stky & 0x04000000) // A hardware loop must be active.
        || s.dma_status || s.systemreg_latency_cycles
        || s.astat_old != s.astat || s.astat_old_old != s.astat
        || s.astat_old_old_old != s.astat)
        return 0;
    // Leave the current instruction's final decrement to execute_run().
    return s.icount - 1;
}
