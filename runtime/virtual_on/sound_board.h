// SPDX-License-Identifier: BSD-3-Clause
// Model 2B SCSP board, running its compiled 68000 program. The 11.2896 MHz CPU,
// 22.5792 MHz SCSP and 44.1 kHz output share an integer clock.
#pragma once
#include "sound_cpu.h"
#include "sound_chip.h"
#include <memory>
namespace von {
class SoundBoard final : public SoundBus {
public:
    SoundRam ram;
    SoundCpu cpu;
    std::unique_ptr<SoundChip> chip;
    std::vector<uint8_t> program, samples;
    uint64_t received = 0;
    SoundBoard(std::vector<uint8_t> p, std::vector<uint8_t> s)
        : cpu(*this), chip(std::make_unique<SoundChip>(ram)), program(std::move(p)), samples(std::move(s)) {
        if (program.size() != 0x80000 || samples.size() != 0x800000) fatalerror("Invalid sound ROM sizes");
        std::copy_n(program.begin(), 16, ram.bytes.begin());
        chip->m_irq_cb.callback = [&](unsigned line, int state) { cpu.execute_set_input(line, state != 0); };
        cpu.reset();
    }
    void advance(uint64_t main_ticks) {
        const uint64_t target = main_ticks * 11289600ull / 25000000;
        while (cpu.cycles < target) {
            cpu.run(int(std::min<uint64_t>(64, target - cpu.cycles)));
            chip->advance(std::max(chip->now, cpu.cycles * 2));
        }
    }
    void receive(uint8_t byte, uint64_t main_ticks) { advance(main_ticks); chip->receive(byte); ++received; }
    void sync(int remaining) { chip->advance(std::max(chip->now, (cpu.cycles - remaining)*2)); }
    uint16_t read(uint32_t a, uint16_t mask, int &remaining) override {
        if (a < 0x80000) { --remaining; return ram.read_word(a); }
        if (a >= 0x100000 && a < 0x101000) { --remaining; sync(remaining); return chip->read((a-0x100000)/2); }
        if (a >= 0x600000 && a < 0x680000) return uint16_t(program[a-0x600000]) << 8 | program[a-0x600000+1];
        if (a >= 0x800000) return uint16_t(samples[a-0x800000]) << 8 | samples[a-0x800000+1];
        return 0;
    }
    void write(uint32_t a, uint16_t value, uint16_t mask, int &remaining) override {
        if (a < 0x80000) {
            --remaining; ram.write_word(a, (ram.read_word(a) & ~mask) | (value & mask)); return;
        }
        if (a >= 0x100000 && a < 0x101000) { --remaining; sync(remaining); chip->write((a-0x100000)/2, value, mask); return; }
        if (a == 0x400000) return; // No banking on this 8 MiB sample ROM board.
    }
};
}
