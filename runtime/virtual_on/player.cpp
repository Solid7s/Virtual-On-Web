// SPDX-License-Identifier: BSD-3-Clause
// Interactive standalone Virtual-On host. No MAME machine, scheduler or CPU
// interpreter is linked. See THIRD_PARTY.md for the imported hardware semantics.
#include "i960.h"
#include "frame_runtime.h"
#include "runtime/video.h"
#include "gpu_frame.h"
#include "sound_board.h"
#include "main_wait.h"
#include <fstream>
#include <iostream>
#include <iterator>
#include <sstream>
#ifdef VON_TEST_ORACLE
#include <map>
#endif
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define VON_EXPORT extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define VON_EXPORT extern "C"
#endif

namespace {
std::vector<uint8_t> load(const std::string &path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) throw std::runtime_error("Cannot read " + path);
    return {std::istreambuf_iterator<char>(file), {}};
}
struct Player {
    std::string files;
    von::Board board;
    von::Coprocessor copro;
    von::I960 cpu;
    von::FrameRuntime frames;
    von::MainWait wait;
    std::unique_ptr<rt::Video> video;
    std::unique_ptr<von::GpuFrame> gpu = std::make_unique<von::GpuFrame>();
    std::unique_ptr<von::SoundBoard> sound;
    rt::VideoMem vmem;
    std::vector<uint8_t> luma = std::vector<uint8_t>(0x20000);
    std::vector<uint32_t> tex0 = std::vector<uint32_t>(0x80000), tex1 = std::vector<uint32_t>(0x80000);
    bool draw = true;
    bool use_gpu = false;
    uint64_t last_parsed = 0;
    uint64_t next_sound = 0, audio_frames = 0;
    float audio_peak = 0;
    uint64_t audio_hash = 14695981039346656037ull;
#ifdef VON_TEST_ORACLE
    std::map<uint32_t, uint32_t> harvested;
#endif
    Player(const std::string &root, bool japan)
        : files(root), board(load(root + (japan ? "/vonj.bin" : "/vonu.bin")), load(root + "/main-data.bin")),
          copro(board, load(root + "/copro-data.bin")), cpu(board),
          frames(board, copro, load(root + "/polygons.bin"), load(root + "/textures.bin")),
          wait(board, japan),
          video(std::make_unique<rt::Video>(board.memory(0x1000000), board.memory(0x1080000))) {
        board.attach_devices(copro);
        board.irq = [&](int line, bool state) { cpu.execute_set_input(line, state); };
        copro.uart = std::make_unique<von::Uart>(board);
        copro.comm = std::make_unique<von::Comm>();
        sound = std::make_unique<von::SoundBoard>(load(root + "/sound-program.bin"), load(root + "/samples.bin"));
        copro.uart->transmit = [&](uint8_t byte) { sound->receive(byte, board.now()); };
        sound->chip->midi_out = [&](uint8_t byte) { copro.uart->receive(byte); };
        if (std::ifstream(root + "/nvram.bin", std::ios::binary)) {
            const auto bytes = load(root + "/nvram.bin");
            if (bytes.size() != 0x4080) throw std::runtime_error("Invalid saved arcade settings");
            for (unsigned i = 0; i < 0x4000; ++i) board.write_byte(0x1d00000 + i, bytes[i]);
            for (unsigned i = 0; i < 64; ++i) board.eeprom.words[i] = bytes[0x4000+i*2] | uint16_t(bytes[0x4001+i*2]) << 8;
        }
        cpu.init_program(japan); cpu.reset();
        frames.geometry->record_pushes = false;
        vmem = {board.memory(0x1800000), board.memory(0x1810000), luma.data(), tex0.data(), tex1.data(), 0};
        frames.present = [&] { if (draw) render(); };
    }
    void render() {
        for (unsigned i = 0; i < 0x8000; ++i) luma[i*4] = copro.luma[i];
        bool textures_changed = vmem.tex_generation == 0;
        for (auto [destination, address] : {std::pair{tex0.data(), 0x11000000u}, std::pair{tex1.data(), 0x11200000u}})
            if (std::memcmp(destination, board.memory(address), 0x100000)) {
                for (unsigned i = 0; i < 2; ++i)
                    std::memcpy(destination + i*0x40000, board.memory(address), 0x100000);
                textures_changed = true;
            }
        if (textures_changed) ++vmem.tex_generation;
        for (unsigned i = 0; i < 0x2000; ++i) video->palette_w(i, vmem.palram, vmem.colorxlat);
        video->xhout_w(uint16_t(board.xoffset - 84));
        video->xvout_w(uint16_t(board.yoffset - 130));
        if (last_parsed != frames.parsed) { video->frame_start(); last_parsed = frames.parsed; }
        video->screen_update(frames.geometry->polys, frames.geometry->windows(), vmem);
        if (use_gpu) gpu->build(board, copro, *video, vmem);
    }
    void frame() {
        sound->chip->samples.clear();
        const auto target = frames.frames + 1;
        unsigned watchdog = 0;
        while (frames.frames < target) {
            wait.advance(cpu, frames, next_sound);
#ifdef VON_TEST_ORACLE
            const unsigned ticks = cpu.oracle_step();
            const uint32_t pc = cpu.m_PIP;
            if (pc >= 0x200000 || !cpu.dispatch[pc >> 2]) harvested[pc] = board.read_dword(pc);
            frames.advance(ticks);
#else
            frames.advance(cpu.step());
#endif
            if (board.now() >= next_sound) { sound->advance(board.now()); next_sound = board.now() + 1024; }
            if (++watchdog > 2000000) throw std::runtime_error("Main CPU frame watchdog");
        }
        sound->advance(board.now());
        audio_frames += sound->chip->samples.size()/2;
        for (auto sample : sound->chip->samples) {
            audio_peak = std::max(audio_peak, std::abs(sample));
            auto bits = von::f2u(sample);
            for (unsigned i = 0; i < 4; ++i) audio_hash = (audio_hash ^ uint8_t(bits >> (i*8))) * 1099511628211ull;
        }
    }
};
std::unique_ptr<Player> player;
std::string error;
template<class F> int guard(F &&f) {
    try { f(); return 1; }
    catch (const von::DeviceBoundary &e) {
        char detail[160]; std::snprintf(detail, sizeof(detail), "%s at %08x (%s %08x)", e.what(), e.address, e.writing ? "write" : "read", e.value);
        error = detail;
    } catch (const std::exception &e) { error = e.what(); }
    if (player) {
        char detail[100]; std::snprintf(detail, sizeof(detail), " [frame %llu, i960 %08x, SHARC %08x]",
            (unsigned long long)player->frames.frames, player->cpu.m_PIP, player->copro.cpu.m_core->pc);
        error += detail;
    }
    std::cerr << error << '\n'; return 0;
}
}
VON_EXPORT const char *von_error() { return error.c_str(); }
VON_EXPORT int von_init(const char *root, int japan) {
    return guard([&] { player.reset(); player = std::make_unique<Player>(root, japan != 0); error.clear(); });
}
VON_EXPORT int von_frame() { return guard([&] { if (!player) throw std::runtime_error("Load a game first"); player->frame(); }); }
VON_EXPORT int von_save_nvram() {
    return guard([&] {
        if (!player) throw std::runtime_error("Load a game first");
        std::ofstream file(player->files + "/nvram.bin", std::ios::binary);
        file.write(reinterpret_cast<const char *>(player->board.memory(0x1d00000)), 0x4000);
        for (auto word : player->board.eeprom.words) { file.put(char(word)); file.put(char(word >> 8)); }
        if (!file) throw std::runtime_error("Cannot save arcade settings");
    });
}
VON_EXPORT const uint32_t *von_screen() { return player ? player->video->screen().data() : nullptr; }
VON_EXPORT uint32_t von_frames() { return player ? player->frames.frames : 0; }
VON_EXPORT uint32_t von_polygons() { return player ? player->frames.geometry->polys.size() : 0; }
VON_EXPORT void von_input(unsigned port, unsigned value) {
    if (player && port < 3) player->board.inputs[port+1] = uint8_t(value);
}
VON_EXPORT uint32_t von_peek(uint32_t address) { return player ? player->board.read_dword(address) : 0; }
VON_EXPORT void von_draw(int enabled) { if (player) player->draw = enabled; }
VON_EXPORT const float *von_audio() { return player ? player->sound->chip->samples.data() : nullptr; }
VON_EXPORT uint32_t von_audio_count() { return player ? player->sound->chip->samples.size()/2 : 0; }
VON_EXPORT float von_audio_peak() { return player ? player->audio_peak : 0; }
VON_EXPORT uint32_t von_audio_total() { return player ? player->audio_frames : 0; }
VON_EXPORT uint32_t von_sound_commands() { return player ? player->sound->received : 0; }
VON_EXPORT void von_fast_wait(int enabled) { if (player) player->wait.enabled = enabled != 0; }
VON_EXPORT uint32_t von_batched_waits() { return player ? player->wait.batched : 0; }
VON_EXPORT const char *von_state() {
    static std::string text;
    if (!player) return "{}";
    auto hash = [](const std::vector<uint32_t> &v) {
        uint64_t h = 14695981039346656037ull;
        for (auto w : v) for (unsigned n = 0; n < 4; ++n) h = (h ^ uint8_t(w >> (n*8))) * 1099511628211ull;
        return h;
    };
    const auto &p = *player;
    std::ostringstream out;
    out << "{\"frames\":" << p.frames.frames << ",\"instructions\":" << p.cpu.instructions << ",\"cycles\":" << p.cpu.cycles
        << ",\"polygons\":" << p.frames.polygons << ",\"soundInstructions\":" << p.sound->cpu.instructions
        << ",\"soundPc\":" << p.sound->cpu.m_ipc << ",\"commands\":" << p.sound->received
        << ",\"audioFrames\":" << p.audio_frames << ",\"audioPeak\":" << p.audio_peak
        << std::hex << ",\"cpu\":\"" << hash(p.cpu.snapshot()) << "\",\"board\":\"" << hash(p.board.snapshot())
        << "\",\"memory\":\"" << p.board.memory_hash() << "\",\"sharc\":\"" << hash(p.copro.cpu.snapshot())
        << "\",\"sharcMemory\":\"" << p.copro.cpu.memory_hash() << "\",\"audio\":\"" << p.audio_hash << "\"}";
    text = out.str(); return text.c_str();
}
VON_EXPORT const uint32_t *von_packet() { return player ? player->gpu->packet.data() : nullptr; }
VON_EXPORT void von_gpu(int enabled) {
    if (player) { player->use_gpu = enabled; player->video->set_external_3d(enabled); }
}
VON_EXPORT void model2_webgpu_margin(int margin) {
    if (player) { player->gpu->margin = std::clamp(margin, 0, 1024); player->frames.geometry->set_wide_margin(player->gpu->margin); }
}

int main(int argc, char **argv) {
    if (argc < 3) return 0;
    if (!von_init(argv[1], std::string(argv[2]) == "vonj")) return 1;
    const unsigned count = argc > 3 ? std::stoul(argv[3]) : 1200;
    player->draw = false;
    if (argc > 6 && std::string(argv[6]) == "--no-fast") player->wait.enabled = false;
    for (unsigned n = 0; n < count; ++n) {
        if (argc > 5 && std::string(argv[5]) == "--play") {
            player->board.inputs[1] = (n >= 1200 && n < 1218) || (n >= 1236 && n < 1254) ? 0xfe
                : n >= 1272 && n < 1290 ? 0xef : 0xff;
            player->board.inputs[2] = n >= 1428 && n < 1446 ? 0xfe : n >= 2100 && n % 90 < 30 ? 0xde : 0xff;
            player->board.inputs[3] = n >= 2100 && n % 90 < 30 ? 0xde : 0xff;
        }
        const bool ok = von_frame();
#ifdef VON_TEST_ORACLE
        if (!ok || n+1 == count) {
            std::ofstream file(std::string(argv[1]) + "/player-" + argv[2] + "-browser-misses.json");
            file << "{\"trace\":{\"i960\":[";
            bool comma = false;
            for (auto [pc, word] : player->harvested) {
                if (comma) file << ','; comma = true;
                file << '[' << std::dec << pc << ",\"" << std::hex << word << "\"]";
            }
            file << "]}}\n";
        }
#endif
        if (!ok) return 1;
        if ((n + 1) % 120 == 0) std::cout << "frame=" << von_frames() << " pc=" << std::hex << player->cpu.m_PIP
            << std::dec << " polygons=" << von_polygons() << " sharc=" << player->copro.cpu.instructions
            << " uart=" << player->copro.uart->bytes_sent << std::endl;
    }
    player->render();
    std::cout << von_state() << '\n';
    if (argc > 4) {
        std::ofstream file(argv[4], std::ios::binary);
        file << "P6\n496 384\n255\n";
        for (auto c : player->video->screen()) for (unsigned shift : {16, 8, 0}) file.put(char(c >> shift));
    }
    return 0;
}
