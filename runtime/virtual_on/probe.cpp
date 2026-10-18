// SPDX-License-Identifier: BSD-3-Clause
// Headless integration probe. A device boundary is a diagnostic, not gameplay.
#include "board.h"
#include "i960.h"
#include "sharc_host.h"
#include "coprocessor.h"
#include "frame_runtime.h"
#include <fstream>
#include <iostream>
#include <iterator>
#include <sstream>

namespace {
std::vector<uint8_t> load(const char *path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) throw std::runtime_error(std::string("Cannot read ") + path);
    return {std::istreambuf_iterator<char>(file), {}};
}
std::string hex64(uint64_t n) { std::ostringstream s; s << std::hex << n; return s.str(); }
uint64_t state_hash(const std::vector<uint32_t> &words) {
    uint64_t hash = 14695981039346656037ull;
    for (uint32_t word : words) for (int i = 0; i < 4; ++i) hash = (hash ^ uint8_t(word >> (i*8))) * 1099511628211ull;
    return hash;
}
}

int main(int argc, char **argv) {
    try {
        if (argc < 3) throw std::runtime_error("Usage: probe vonu|vonj PROGRAM.bin [instruction-limit] [trace.bin] [DATA.bin]");
        const bool japan = std::string(argv[1]) == "vonj";
        if (!japan && std::string(argv[1]) != "vonu") throw std::runtime_error("Unsupported set");
        const uint64_t limit = argc > 3 ? std::stoull(argv[3]) : 10000000;
        std::ofstream trace;
        if (argc > 4 && std::string(argv[4]) != "-") {
            trace.open(argv[4], std::ios::binary);
            if (!trace) throw std::runtime_error("Cannot open trace output");
        }
        auto bytes = load(argv[2]);
        von::Board board(bytes, argc > 5 ? load(argv[5]) : std::vector<uint8_t>{});
        const bool geometry = argc > 6 && std::string(argv[6]) == "--geometry";
        if (geometry && argc < 10) throw std::runtime_error("--geometry requires COPRO.bin POLYGONS.bin TEXTURES.bin");
        std::unique_ptr<von::Coprocessor> copro;
        von::SharcHost upload;
        const auto copro_data = geometry && argc > 7 ? load(argv[7]) : std::vector<uint8_t>{};
        if (geometry) copro = std::make_unique<von::Coprocessor>(board, copro_data);
        const auto models = geometry ? load(argv[8]) : std::vector<uint8_t>{};
        const auto textures = geometry ? load(argv[9]) : std::vector<uint8_t>{};
        std::unique_ptr<von::FrameRuntime> frames;
        if (geometry) frames = std::make_unique<von::FrameRuntime>(board, *copro, models, textures);
        von::SharcHost &sharc = geometry ? *copro : upload;
        board.attach_devices(sharc);
        von::I960 cpu(board);
        board.irq = [&](int line, bool value) { cpu.execute_set_input(line, value); };
        cpu.init_program(japan); cpu.reset();
#ifdef VON_TEST_ORACLE
        von::Board reference_board(bytes, argc > 5 ? load(argv[5]) : std::vector<uint8_t>{});
        std::unique_ptr<von::Coprocessor> reference_copro;
        von::SharcHost reference_upload;
        if (geometry) reference_copro = std::make_unique<von::Coprocessor>(reference_board, copro_data, true);
        std::unique_ptr<von::FrameRuntime> reference_frames;
        if (geometry) reference_frames = std::make_unique<von::FrameRuntime>(reference_board, *reference_copro, models, textures);
        von::SharcHost &reference_sharc = geometry ? *reference_copro : reference_upload;
        reference_board.attach_devices(reference_sharc);
        von::I960 reference(reference_board);
        reference_board.irq = [&](int line, bool value) { reference.execute_set_input(line, value); };
        reference.reset();
        board.journal = reference_board.journal = true;
        uint64_t checked_sharc = UINT64_MAX;
#endif
        uint64_t checked = 0;
        std::string stopped = "instruction limit";
        uint32_t address = 0, value = 0, mask = 0; bool writing = false;
        for (; checked < limit; ++checked) {
            bool boundary = false;
            try { const auto ticks = cpu.step(); if (frames) frames->advance(ticks); else board.advance(ticks); }
            catch (const von::DeviceBoundary &e) {
                stopped = e.what(); address = e.address; value = e.value; mask = e.mask; writing = e.writing; boundary = true;
            }
#ifdef VON_TEST_ORACLE
            bool ref_boundary = false;
            try { const auto ticks = reference.oracle_step(); if (reference_frames) reference_frames->advance(ticks); else reference_board.advance(ticks); }
            catch (const von::DeviceBoundary &e) {
                ref_boundary = true;
                if (!boundary || address != e.address || value != e.value || mask != e.mask || writing != e.writing)
                    throw std::runtime_error("Device boundary differs from interpreter oracle");
            }
            if (boundary != ref_boundary || cpu.snapshot() != reference.snapshot() ||
                cpu.cycles != reference.cycles || board.writes != reference_board.writes ||
                board.snapshot() != reference_board.snapshot())
                von::fatalerror("Oracle mismatch at instruction %llu, pc %08x", (unsigned long long)checked, cpu.m_PIP);
            if (geometry && copro->started) {
                if (copro->cpu.instructions != reference_copro->cpu.instructions ||
                    (checked_sharc != copro->cpu.instructions && copro->cpu.snapshot() != reference_copro->cpu.snapshot()) ||
                    copro->input != reference_copro->input || copro->output != reference_copro->output)
                    von::fatalerror("SHARC oracle mismatch after main instruction %llu", (unsigned long long)checked);
                checked_sharc = copro->cpu.instructions;
            }
            board.writes.clear(); reference_board.writes.clear();
#endif
            if (boundary) break;
            if (trace.is_open()) {
                uint32_t hash = 2166136261u;
                for (uint32_t word : cpu.snapshot()) for (int i = 0; i < 4; ++i)
                    hash = (hash ^ uint8_t(word >> (i*8))) * 16777619u;
                char packed[16]; unsigned index = 0;
                for (uint32_t word : {cpu.m_PIP, cpu.m_IP, hash, uint32_t(-cpu.m_icount)})
                    for (int i = 0; i < 4; ++i) packed[index++] = char(word >> (i*8));
                trace.write(packed, sizeof(packed));
            }
        }
#ifdef VON_TEST_ORACLE
        if (board.memory_hash() != reference_board.memory_hash()) throw std::runtime_error("Final memory mismatch");
        if (sharc.program_bytes() != reference_sharc.program_bytes()) throw std::runtime_error("SHARC upload mismatch");
        if (geometry && (copro->cpu.memory_hash() != reference_copro->cpu.memory_hash() ||
                         copro->cpu.snapshot() != reference_copro->cpu.snapshot()))
            throw std::runtime_error("SHARC memory mismatch");
        if (geometry && (copro->luma != reference_copro->luma || copro->geo.control != reference_copro->geo.control ||
            copro->geo.uploaded != reference_copro->geo.uploaded || copro->geo.read_start != reference_copro->geo.read_start ||
            copro->geo.write_start != reference_copro->geo.write_start)) throw std::runtime_error("Geometry port state mismatch");
        if (geometry && (frames->frames != reference_frames->frames || frames->polygons != reference_frames->polygons ||
            frames->command_hash != reference_frames->command_hash)) throw std::runtime_error("Geometry frame mismatch");
#endif
        if (argc > 4 && std::string(argv[4]) != "-") {
            const auto upload = sharc.program_bytes();
            std::ofstream image(std::string(argv[4]) + ".sharc.bin", std::ios::binary);
            image.write(reinterpret_cast<const char *>(upload.data()), upload.size());
        }
        std::cout << "{\"set\":\"" << argv[1] << "\",\"standalone\":true,\"playable\":false,\"oracle\":"
#ifdef VON_TEST_ORACLE
            << "true"
#else
            << "false"
#endif
            << ",\"instructions\":" << cpu.instructions << ",\"cycles\":" << cpu.cycles
            << ",\"sharcUploadedHalfwords\":" << sharc.uploaded_halfwords
            << ",\"sharcProgramWords\":" << sharc.program_words
            << ",\"pc\":\"" << hex64(cpu.m_PIP) << "\",\"cpuHash\":\"" << hex64(state_hash(cpu.snapshot()))
            << "\",\"memoryHash\":\"" << hex64(board.memory_hash()) << "\",\"boardHash\":\"" << hex64(state_hash(board.snapshot()))
            << "\",\"stop\":\"" << stopped << "\",\"address\":\"" << hex64(address)
            << "\",\"value\":\"" << hex64(value) << "\",\"mask\":\"" << hex64(mask)
            << "\",\"writing\":" << (writing ? "true" : "false");
        if (argc > 6 && std::string(argv[6]) == "--state") {
            std::cout << ",\"state\":[";
            bool comma = false;
            for (uint32_t v : cpu.snapshot()) { if (comma) std::cout << ','; std::cout << v; comma = true; }
            std::cout << ']';
        }
        if (geometry) std::cout << ",\"sharcInstructions\":" << copro->cpu.instructions
            << ",\"sharcYields\":" << copro->yields << ",\"sharcInputWords\":" << copro->input_words
            << ",\"sharcOutputWords\":" << copro->output_words << ",\"sharcPc\":\"" << hex64(copro->cpu.m_core->pc)
            << "\",\"sharcHash\":\"" << hex64(state_hash(copro->cpu.snapshot()))
            << "\",\"sharcMemoryHash\":\"" << hex64(copro->cpu.memory_hash()) << "\",\"geometryUploadedWords\":" << copro->geo.uploaded
            << ",\"vblanks\":" << frames->frames << ",\"geometryFrames\":" << frames->parsed << ",\"polygons\":" << frames->polygons
            << ",\"geometryHash\":\"" << hex64(frames->command_hash) << "\"";
        std::cout << "}\n";
        return 0;
    } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
