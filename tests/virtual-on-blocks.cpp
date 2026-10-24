// SPDX-License-Identifier: BSD-3-Clause
// Every generated block and ROM entry vs the pinned single-step interpreter.
// ROMs and generated programs remain local; this test itself contains no ROM.
#include "i960.h"
#include <fstream>
#include <iostream>
#include <iterator>
#include <random>

struct ReadOnlyBus final : von::Bus {
    std::vector<uint8_t> rom;
    bool forbidden = false;
    explicit ReadOnlyBus(const std::string &path) {
        std::ifstream file(path, std::ios::binary);
        rom = {std::istreambuf_iterator<char>(file), {}};
        if (rom.size() != 0x200000) throw std::runtime_error("Expected local 2 MiB program ROM");
    }
    uint8_t read_byte(uint32_t a) override {
        if (forbidden || a >= rom.size()) throw std::runtime_error("Unexpected block bus access");
        return rom[a];
    }
    uint16_t read_word(uint32_t a) override { return read_byte(a) | uint16_t(read_byte(a+1)) << 8; }
    uint32_t read_dword(uint32_t a) override { return read_word(a) | uint32_t(read_word(a+2)) << 16; }
    void write_byte(uint32_t, uint8_t) override { throw std::runtime_error("Unexpected block write"); }
    void write_word(uint32_t, uint16_t) override { throw std::runtime_error("Unexpected block write"); }
    void write_dword(uint32_t, uint32_t) override { throw std::runtime_error("Unexpected block write"); }
    uint16_t flags(uint32_t) const override { throw std::runtime_error("Unexpected block flags"); }
};

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    uint64_t cases = 0, guards = 0;
    std::mt19937 rng(0x960);
    for (bool japan : {false, true}) {
        ReadOnlyBus bus(std::string(argv[1]) + (japan ? "/vonj.bin" : "/vonu.bin"));
        von::I960 cpu(bus), reference(bus);
        cpu.init_program(japan);
        for (uint32_t pc = 0; pc < 0x200000; pc += 4) {
            const auto *entry = cpu.dispatch[pc >> 2];
            const auto *block = entry ? entry->block : nullptr;
            if (!block) continue;
            for (unsigned sample = 0; sample < 12; ++sample) {
                for (unsigned r = 0; r < 32; ++r)
                    cpu.m_r[r] = reference.m_r[r] = sample == 0 ? 0 : sample == 1 ? UINT32_MAX
                        : sample == 2 ? 0x80000000u : sample == 3 ? r : rng();
                cpu.m_AC = reference.m_AC = rng();
                cpu.m_IP = reference.m_IP = pc;
                cpu.m_PIP = reference.m_PIP = pc - 4;
                cpu.m_icount = reference.m_icount = -1;
                cpu.m_stalled = reference.m_stalled = false;
                cpu.instructions = reference.instructions = 0;
                cpu.cycles = reference.cycles = 0;
                auto reject = [&](uint64_t budget) {
                    const auto state = cpu.snapshot();
                    if (cpu.run_register_block(budget) || state != cpu.snapshot() || cpu.instructions || cpu.cycles)
                        throw std::runtime_error("Block guard changed CPU state");
                    ++guards;
                };
                bus.forbidden = true;
                reject(0); reject(block->ticks - 1); reject(block->ticks);
                cpu.m_immediate_irq = 1; reject(UINT64_MAX); cpu.m_immediate_irq = 0;
                cpu.m_stall_state.burst_mode = true; reject(UINT64_MAX); cpu.m_stall_state.burst_mode = false;
                cpu.blocks_enabled = false; reject(UINT64_MAX); cpu.blocks_enabled = true;
                cpu.m_IP = pc + 1; reject(UINT64_MAX);
                cpu.m_IP = 0x500000; reject(UINT64_MAX); cpu.m_IP = pc;
                const auto ticks = cpu.run_register_block(block->ticks + 1);
                bus.forbidden = false;
                unsigned oracle_ticks = 0;
                for (unsigned i = 0; i < block->count; ++i) oracle_ticks += reference.oracle_step();
                if (ticks != oracle_ticks || cpu.snapshot() != reference.snapshot() ||
                    cpu.instructions != reference.instructions || cpu.cycles != reference.cycles)
                    von::fatalerror("Block mismatch: region %u pc %08x sample %u", japan, pc, sample);
                ++cases;
            }
        }
    }
    std::cout << "{\"matchedBlockCases\":" << cases << ",\"guardChecks\":" << guards << "}\n";
}
