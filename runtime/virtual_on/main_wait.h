// SPDX-License-Identifier: BSD-3-Clause
// Exact batching of the ROM's five-instruction frame-counter polling loop.
// Preserve its incremented g0, instruction/cycle totals and architectural state;
// never cross a board, UART, audio-service or video event.
#pragma once
#include "i960.h"
#include "frame_runtime.h"
namespace von {
class MainWait {
public:
    bool enabled = true;
    uint32_t pc;
    uint64_t batched = 0;
    MainWait(Board &board, bool japan) : pc(japan ? 0x28e2c : 0x29a3c) {
        constexpr uint32_t words[] = {0x90a59000,0x58a50884,0x5a052095,0x59805010,0x12fffff0};
        for (unsigned i = 0; i < 5; ++i)
            if (board.read_dword(pc + i*4) != words[i]) fatalerror("Frame-wait program guard failed");
    }
    void advance(I960 &cpu, FrameRuntime &frames, uint64_t next_sound) {
        if (!enabled || cpu.m_IP != pc || cpu.m_PIP != pc+16 || cpu.m_stall_state.burst_mode ||
            cpu.m_immediate_irq || cpu.m_r[22] != 0x98000c || cpu.m_r[20] != cpu.m_r[21] || (cpu.m_AC & 7) != 2)
            return;
        auto &board = frames.board;
        if ((board.read_dword(0x98000c) & 4) != cpu.m_r[21]) return;
        const uint64_t deadline = std::min({frames.next_vblank, board.next_event(),
            frames.copro.uart ? frames.copro.uart->next_event() : UINT64_MAX, next_sound});
        if (deadline <= board.now()+8) return;
        // ld=4, and=1, cmpi=1, addo=1, be=1: eight 25 MHz ticks.
        const uint64_t loops = (deadline - board.now() - 1) / 8;
        if (!loops) return;
        cpu.m_r[16] += uint32_t(loops);
        cpu.instructions += loops*5; cpu.cycles += loops*8; batched += loops;
        frames.advance(unsigned(loops*8));
    }
};
}
