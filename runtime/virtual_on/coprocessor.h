// SPDX-License-Identifier: BSD-3-Clause
// Virtual-On-specific cooperative geometry execution. No global device scheduler.
#pragma once
#include "sharc.h"
#include "sharc_host.h"
#include "geometry_ports.h"
#include "uart.h"
#include "comm.h"
#include <deque>

namespace von {
class Coprocessor final : public SharcHost {
public:
    Board &board;
    Sharc cpu;
    GeometryPorts geo;
    bool started = false, oracle = false;
    uint64_t yields = 0, input_words = 0, output_words = 0;
    std::deque<uint32_t> input, output;
    std::vector<uint8_t> data;
    std::array<uint8_t, 0x8000> luma{};
    std::function<void(const Sharc &)> instruction_hook;
    std::unique_ptr<Uart> uart;
    std::unique_ptr<Comm> comm;
    explicit Coprocessor(Board &b, std::vector<uint8_t> rom = {}, bool reference = false)
        : board(b), geo(b), oracle(reference), data(std::move(rom)) {
        if (!data.empty() && data.size() != 0x800000) fatalerror("Expected 8 MiB coprocessor data region");
        board.sync_buffer = [&] { if (started && !pumping_) pump(false); };
        cpu.set_flag_input(0, true);
        cpu.external_read = [&](uint32_t a) {
            if (a >= 0x400000 && a <= 0xbfffff) {
                if (input.empty()) fatalerror("SHARC consumed empty input FIFO at %08x", cpu.m_core->pc);
                const auto value = input.front(); input.pop_front();
                cpu.set_flag_input(0, input.empty()); return value;
            }
            if (a >= 0x1400000 && a <= 0x1bfffff)
                return board.read_dword(0x900000 + (a & 0x7fff)*4);
            if (a >= 0x1c00000 && a <= 0x1dfffff && !data.empty()) {
                const auto p = (a-0x1c00000)*4;
                return uint32_t(data[p]) | uint32_t(data[p+1]) << 8 | uint32_t(data[p+2]) << 16 | uint32_t(data[p+3]) << 24;
            }
            throw DeviceBoundary("SHARC external read", a, 0, ~0u, false);
        };
        cpu.external_write = [&](uint32_t a, uint32_t v) {
            if (a >= 0xc00000 && a <= 0x13fffff) {
                if (output.size() >= 16) fatalerror("SHARC output FIFO overflow");
                output.push_back(v); ++output_words;
                // Match the pinned board callback: FLAG1 observes the input
                // FIFO's full state whenever the output FIFO changes.
                cpu.set_flag_input(1, input.size() == 16); return;
            }
            if (a >= 0x1400000 && a <= 0x1bfffff) {
                board.write_dword(0x900000 + (a & 0x7fff)*4, v); return;
            }
            throw DeviceBoundary("SHARC external write", a, v, ~0u, true);
        };
        boot = [&] {
            if (program_words < Sharc::program_size) fatalerror("Incomplete SHARC program upload");
            for (uint32_t i = 0; i < program_words; ++i)
                if (cpu.pm_read48(0x20000+i) != program[i]) fatalerror("SHARC host upload differs at %x", i);
            for (uint32_t i = 0; i < Sharc::program_size; ++i)
                if (program[i] != Sharc::program[i].word) fatalerror("Unexpected SHARC program at %x", i);
            started = true;
            pump(false);
        };
    }
    ~Coprocessor() override { board.sync_buffer = {}; }
    void pump(bool need_output) {
        if (pumping_) fatalerror("Recursive SHARC execution");
        struct Active { bool &flag; explicit Active(bool &f) : flag(f) { flag = true; } ~Active() { flag = false; } } active(pumping_);
        // Bounded watchdog is a diagnostic, never a guessed successful result.
        for (unsigned budget = 0; budget < 1000000; ++budget) {
            if (need_output && !output.empty()) return;
            if (cpu.waiting_for_input()) { ++yields; return; }
            if (output.size() == 16) return;
#ifdef VON_SHARC_MATH
            if (!oracle && !instruction_hook && cpu.m_core->daddr == 0x20dd8) {
                if (const auto count = cpu.run_polynomial()) { budget += count - 1; continue; }
            }
#endif
            cpu.step(oracle);
            if (instruction_hook) instruction_hook(cpu);
        }
        const auto &s = *cpu.m_core;
        fatalerror("SHARC watchdog pc=%08x loop=%08x/%x/%u top=%08x flags=%u,%u pipeline=%x,%x,%x opcode=%llx dma=%x latency=%u irq=%x",
            s.pc, s.laddr.addr, s.laddr.code, s.laddr.loop_type, s.pcstk, s.flag[0], s.flag[1],
            s.daddr, s.faddr, s.nfaddr, (unsigned long long)s.opcode, s.dma_status, s.systemreg_latency_cycles, s.irq_pending);
    }
    uint32_t read(uint32_t a, uint32_t mask) override {
        if (comm && (a & ~0x13fffu) == 0x1a00000) {
            uint32_t value = 0;
            for (unsigned i = 0; i < 4; ++i) if (mask & (0xffu << (i*8)))
                value |= uint32_t(comm->read((a & 0xffff) + i)) << (i*8);
            return value;
        }
        if (comm && (a == 0x1a04000 || a == 0x1a14000))
            return uint32_t(comm->read(0x4000)) | uint32_t(comm->read(0x4002)) << 16;
        if (uart && (a == 0x9c0000 || a == 0x9c0004)) return (mask & 0xff) ? uart->read(a == 0x9c0004) : 0;
        if (a >= 0x11400000 && a <= 0x1140fffc) {
            const auto offset = (a-0x11400000)/2;
            return uint32_t(luma[offset]) | uint32_t(luma[offset+1]) << 16;
        }
        if (a >= 0x800000 && a <= 0x807ffc) return geo.read(a);
        if (started && a == 0x980004) {
            if (output.empty()) pump(true);
            return output.empty() ? 1 : 0;
        }
        if (started && a >= 0x884000 && a <= 0x887ffc) {
            if (output.empty()) pump(true);
            if (output.empty()) throw DeviceBoundary("SHARC output FIFO needs input", a, 0, mask, false);
            auto value = output.front(); output.pop_front();
            cpu.set_flag_input(1, input.size() == 16); return value;
        }
        return SharcHost::read(a, mask);
    }
    void push(uint32_t v) {
        if (input.size() == 16) pump(false);
        if (input.size() == 16) fatalerror("SHARC input FIFO cannot make progress");
        input.push_back(v); ++input_words;
        cpu.set_flag_input(0, false);
    }
    void write(uint32_t a, uint32_t v, uint32_t mask) override {
        if (comm && ((a & ~0x13fffu) == 0x1a00000 || a == 0x1a04000 || a == 0x1a14000)) {
            for (unsigned i = 0; i < 4; ++i) if (mask & (0xffu << (i*8)))
                comm->write((a & 0xffff) + i, uint8_t(v >> (i*8)));
            return;
        }
        if (uart && (a == 0x9c0000 || a == 0x9c0004)) { if (mask & 0xff) uart->write(a == 0x9c0004, uint8_t(v)); return; }
        if (a >= 0x11400000 && a <= 0x1140fffc) {
            const auto offset = (a-0x11400000)/2;
            if (mask & 0xff) luma[offset] = uint8_t(v);
            if (mask & 0xff0000) luma[offset+1] = uint8_t(v >> 16);
            return;
        }
        if ((a >= 0x800000 && a <= 0x807ffc) || a == 0x980008) { geo.write(a, v & mask); return; }
        if (started && a >= 0x880000 && a <= 0x883ffc) {
            push((v & 0x800fffff) | ((((a-0x880000) >> 4) & 0xff) << 23)); return;
        }
        if (started && !(control & 0x80000000) && a >= 0x884000 && a <= 0x887ffc) { push(v); return; }
        if (a >= 0x8c0000 && a <= 0x8c0ffc) {
            cpu.external_iop_write((a-0x8c0000)/4, v);
            if (started) return;
        }
        if (a >= 0x884000 && a <= 0x887ffc && (control & 0x80000000))
            cpu.external_dma_write(uploaded_halfwords, uint16_t(v));
        SharcHost::write(a, v, mask);
    }
private:
    bool pumping_ = false;
};
} // namespace von
