// SPDX-License-Identifier: BSD-3-Clause
// Reach the sound ROM at its Model 2B address, using Daytona's static decoder.
#include "m68k/reach.h"
#include <fstream>
#include <iostream>
#include <iterator>
#include <optional>
#include <vector>

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    std::ifstream input(argv[1], std::ios::binary);
    const std::vector<unsigned char> bytes((std::istreambuf_iterator<char>(input)), {});
    if (bytes.size() != 0x80000) return 3;
    const m68k::ReadWord read = [&](uint32_t pc) -> std::optional<uint16_t> {
        if (pc < 0x600000 || pc >= 0x67ffff || (pc & 1)) return {};
        const auto offset = pc - 0x600000;
        return uint16_t(bytes[offset]) << 8 | bytes[offset + 1];
    };
    auto seeds = m68k::vector_seeds([&](uint32_t pc) { return read(pc < 256 ? pc + 0x600000 : pc); });
    std::ifstream seed_file(argv[2]);
    uint32_t pc;
    while (seed_file >> std::hex >> pc) seeds.push_back(pc);
    const auto result = m68k::reach(seeds, read);
    for (const auto &[pc, insn] : result.insns)
        std::cout << std::hex << pc << ' ' << insn.opcode << '\n';
    std::cerr << "Reached " << result.insns.size() << " sound instructions; "
        << result.indirect_sites.size() << " indirect sites.\n";
}
