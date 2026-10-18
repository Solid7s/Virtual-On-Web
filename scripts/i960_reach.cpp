// SPDX-License-Identifier: BSD-3-Clause
// Small adapter around Daytona's decoder. Output stays in ignored build/.
#include "i960/reach.h"
#include <fstream>
#include <iostream>
#include <iterator>
#include <optional>
#include <vector>

int main(int argc, char **argv) {
    if (argc < 2) return 2;
    std::ifstream input(argv[1], std::ios::binary);
    std::vector<unsigned char> bytes((std::istreambuf_iterator<char>(input)), {});
    if (bytes.size() != 0x200000) return 3;
    const i960::ReadWord read = [&](uint32_t address) -> std::optional<uint32_t> {
        if (address > bytes.size() - 4 || (address & 3)) return {};
        return uint32_t(bytes[address]) | uint32_t(bytes[address+1]) << 8 |
            uint32_t(bytes[address+2]) << 16 | uint32_t(bytes[address+3]) << 24;
    };
    if (argc == 5 && std::string(argv[2]) == "--disassemble") {
        uint32_t pc = std::stoul(argv[3], nullptr, 16), end = std::stoul(argv[4], nullptr, 16);
        while (pc < end) {
            const auto word = read(pc);
            if (!word) return 4;
            const auto instruction = i960::decode(pc, *word, read(pc + 4).value_or(0));
            std::cout << std::hex << pc << ' ' << i960::format_mame(instruction) << '\n';
            pc += instruction.length;
        }
        return 0;
    }
    auto seeds = i960::boot_seeds(read).all();
    // Optional harvested PCs extend coverage through indirect control flow.
    if (argc > 2) {
        std::ifstream seed_file(argv[2]);
        uint32_t pc;
        while (seed_file >> std::hex >> pc) seeds.push_back(pc);
    }
    const auto reached = i960::reach(seeds, read);
    for (const auto &[pc, insn] : reached.insns)
        std::cout << std::hex << pc << ' ' << insn.word << '\n';
    std::cerr << "Reached " << reached.insns.size() << " instructions, "
        << reached.indirect_sites.size() << " indirect sites, "
        << reached.stops.size() << " undecodable stops.\n";
}
