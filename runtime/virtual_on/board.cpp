// SPDX-License-Identifier: BSD-3-Clause
// See board.h for source attribution. This is an independent board runtime.
#include "board.h"
#include <algorithm>

namespace von {
namespace {
// Mapped peripherals still awaiting their standalone implementations. Addresses
// outside both these ranges and RAM/ROM really are unmapped in model2b_crx_mem;
// the pinned reference returns zero there and ignores writes (board detection).
bool mapped_device(uint32_t a) {
    constexpr uint32_t ranges[][2] = {
        {0x00800000, 0x00807fff}, {0x00880000, 0x00887fff}, {0x008c0000, 0x008c0fff},
        {0x00980000, 0x0098003f}, {0x009c0000, 0x009c0007},
        {0x01040000, 0x01040003}, {0x01140000, 0x01140003},
        {0x01060000, 0x01060003}, {0x01160000, 0x01160003},
        {0x0181c000, 0x0181c003}, {0x01a00000, 0x01a04003}, {0x01a10000, 0x01a14003},
        {0x02000000, 0x03ffffff}, {0x06000000, 0x06ffffff},
        {0x10400000, 0x105fffff}, {0x11400000, 0x1140ffff},
    };
    for (auto &range : ranges) if (a >= range[0] && a <= range[1]) return true;
    return false;
}
}
size_t Board::add(uint32_t base, uint32_t size, uint8_t fill, bool burst) {
    size_t id = memory_.size();
    memory_.emplace_back(size, fill);
    regions_.push_back({base, size, 0, id, false, burst});
    return id;
}
void Board::alias(uint32_t base, uint32_t size, size_t id, uint32_t offset, bool readonly) {
    if (uint64_t(offset) + size > memory_.at(id).size()) throw std::runtime_error("Invalid board alias");
    regions_.push_back({base, size, offset, id, readonly, true});
}
Board::Board(std::vector<uint8_t> program, std::vector<uint8_t> data) {
    if (program.size() != 0x200000) throw std::runtime_error("Expected 2 MiB Virtual-On program");
    memory_.push_back(std::move(program)); alias(0, 0x200000, 0, 0, true);
    add(0x00200000, 0x40000); add(0x00500000, 0x100000);
    size_t buffer = add(0x00900000, 0x20000);
    for (uint32_t offset = 0; offset < 0x20000; offset += 4) {
        memory_[buffer][offset] = 0x0f; memory_[buffer][offset+1] = 0x0f;
        memory_[buffer][offset+2] = 0x80; memory_[buffer][offset+3] = 0x07;
    }
    for (uint32_t base : {0x00920000u, 0x00940000u, 0x00960000u}) alias(base, 0x20000, buffer);
    add(0x00e00000, 0x38, 0, false);
    auto tile = add(0x01000000, 0x10000);
    for (uint32_t base : {0x01010000u, 0x01100000u, 0x01110000u}) alias(base, 0x10000, tile);
    auto chars = add(0x01080000, 0x80000); alias(0x01180000, 0x80000, chars);
    add(0x01800000, 0x4000); add(0x01810000, 0xc000);
    // Communication registers/RAM remain device calls until its port exists.
    add(0x01d00000, 0x4000, 0xff);
    if (!data.empty()) {
        if (data.size() != 0x2000000) throw std::runtime_error("Expected 32 MiB data region");
        auto id = memory_.size(); memory_.push_back(std::move(data));
        alias(0x02000000, 0x2000000, id, 0, true);
        alias(0x06000000, 0x1000000, id, 0x1000000, true);
    }
    auto tex0 = add(0x11000000, 0x100000); alias(0x11100000, 0x100000, tex0);
    auto tex1 = add(0x11200000, 0x100000); alias(0x11300000, 0x100000, tex1);
    add(0x11600000, 0x80000); add(0x11680000, 0x80000);
    std::sort(regions_.begin(), regions_.end(), [](const auto &a, const auto &b) { return a.base < b.base; });
    memory_generations_.resize(memory_.size());
    if (regions_.size() > 255) throw std::runtime_error("Too many board regions");
    for (size_t i = 0; i < regions_.size(); ++i) {
        const auto &r = regions_[i];
        for (uint32_t page = r.base >> 16; page <= (r.base + r.size - 1) >> 16; ++page) {
            if (region_pages_[page]) throw std::runtime_error("Overlapping board pages");
            region_pages_[page] = uint8_t(i + 1);
        }
    }
}
const Board::Region *Board::region(uint32_t a) const {
    const auto id = region_pages_[a >> 16];
    if (!id) return nullptr;
    const auto &r = regions_[id - 1];
    return a - r.base < r.size ? &r : nullptr;
}
uint16_t Board::flags(uint32_t a) const {
    if (auto r = region(a)) return r->burst;
    if ((a >= 0x01a00000 && a < 0x01a04000) || (a >= 0x01a10000 && a < 0x01a14000) ||
        (a >= 0x11400000 && a < 0x11410000) || (a & ~0x100003u) == 0x01020000) return 1;
    return 0;
}
const uint8_t *Board::memory(uint32_t address) const {
    auto r = region(address);
    if (!r) throw std::runtime_error("No memory at requested address");
    return memory_[r->storage].data() + r->offset + address - r->base;
}
uint64_t Board::memory_generation(uint32_t address) const {
    auto r = region(address);
    if (!r) throw std::runtime_error("No memory at requested address");
    return memory_generations_[r->storage];
}
uint32_t Board::read(uint32_t a, unsigned n) {
    if (a >= 0x900000 && a < 0x980000 && sync_buffer) sync_buffer();
    if (auto r = region(a); r && n <= r->size - (a - r->base)) {
        const auto &bytes = memory_[r->storage]; uint32_t v = 0;
        for (unsigned i = 0; i < n; ++i) v |= uint32_t(bytes[r->offset + a - r->base + i]) << (i * 8);
        return v;
    }
    if ((a & 3) + n > 4) {
        uint32_t v = 0; for (unsigned i = 0; i < n; ++i) v |= uint32_t(read_byte(a+i)) << (i*8); return v;
    }
    const uint32_t mask = n == 4 ? ~0u : ((1u << (n*8)) - 1) << ((a & 3)*8);
    return (device_read(a & ~3u, mask) & mask) >> ((a & 3)*8);
}
void Board::write(uint32_t a, uint32_t v, unsigned n) {
    if (auto r = region(a); r && n <= r->size - (a - r->base)) {
        if (r->readonly) return;
        if (journal) writes.push_back({a, v, n == 4 ? ~0u : (1u << (n*8)) - 1});
        auto &bytes = memory_[r->storage];
        for (unsigned i = 0; i < n; ++i) bytes[r->offset + a - r->base + i] = uint8_t(v >> (i*8));
        ++memory_generations_[r->storage];
        return;
    }
    if ((a & 3) + n > 4) { for (unsigned i = 0; i < n; ++i) write_byte(a+i, uint8_t(v >> (i*8))); return; }
    const uint32_t mask = n == 4 ? ~0u : ((1u << (n*8)) - 1) << ((a & 3)*8);
    v <<= (a & 3)*8; a &= ~3u;
    if (journal) writes.push_back({a, v, mask});
    device_write(a, v, mask);
}
uint8_t Board::read_byte(uint32_t a) { return uint8_t(read(a, 1)); }
uint16_t Board::read_word(uint32_t a) { return uint16_t(read(a, 2)); }
uint32_t Board::read_dword(uint32_t a) { return read(a, 4); }
void Board::write_byte(uint32_t a, uint8_t v) { write(a, v, 1); }
void Board::write_word(uint32_t a, uint16_t v) { write(a, v, 2); }
void Board::write_dword(uint32_t a, uint32_t v) { write(a, v, 4); }

uint8_t Board::io_read(unsigned index) {
    if (index <= 6) {
        if (index == 6 && (mode_ & 0x80)) {
            ports_[6] = (ports_[6] & 0xf8) | ((ports_[6]+1) & 7); return 0;
        }
        if (!BIT(direction_, index)) return ports_[index];
        if (index == 1 && control_mode_) return 0xd0 | (uint8_t(eeprom.output(now_)) << 5) | (inputs[1] & 0x0f);
        return inputs[index];
    }
    if (index == 0x0b || index == 0x0c) return 0;
    if (index == 0x0d) return 0x0c;
    if (index == 0x0f) { auto v = analog[analog_channel_]; analog_channel_ = (analog_channel_+1) & 7; return v; }
    return 0xff;
}
void Board::io_write(unsigned index, uint8_t v) {
    if (index <= 6) {
        if (index == 0) { control_mode_ = v & 1; eeprom.pins(v, now_); }
        ports_[index] = v;
    }
    else if (index == 8) direction_ = v;
    else if (index == 0xe) mode_ = v;
    else if (index == 0xf) analog_channel_ = v & 7;
    else if (index == 9 || index == 0xa) devices_->write(0x01c00000 + index*2, v, 0xff);
}
uint32_t Board::device_read(uint32_t a, uint32_t mask) {
    if ((a & ~0x100000u) == 0x01040000 || (a & ~0x100000u) == 0x01060000 || a == 0x0181c000) return 0;
    if (a == 0x00e80000) return requested_;
    if (a == 0x00e80004) return enabled_;
    if (a >= 0x00f00000 && a < 0x00f00010) {
        auto &t = timers_[(a-0x00f00000)/4];
        if (t.running) t.value = t.original - uint32_t(now_ - t.start);
        return t.value;
    }
    if (a == 0x0098000c) return (video_ & 3) | ((render_ & 4) ? (frame_ & 1) << 2 : (frame_ & 2) << 1);
    if (a >= 0x10000000 && a < 0x10200000) return render_;
    if (a >= 0x01c00000 && a < 0x01c00020) {
        uint32_t v = 0;
        for (unsigned lane : {0u, 2u}) if (mask & (0xffu << (lane*8)))
            v |= uint32_t(io_read((a-0x01c00000+lane)/2)) << (lane*8);
        return v;
    }
    return mapped_device(a) ? devices_->read(a, mask) : 0;
}
void Board::device_write(uint32_t a, uint32_t v, uint32_t mask) {
    auto combine = [&](uint32_t &dst) { dst = (dst & ~mask) | (v & mask); };
    if ((a & ~0x100000u) == 0x01040000) { if (mask & 0xffff) xoffset = 84 + int16_t(v); return; }
    if ((a & ~0x100000u) == 0x01060000) { if (mask & 0xffff) yoffset = 130 + int16_t(v); return; }
    if (a == 0x0181c000) { zclip = v; return; }
    if (a == 0x00e80000) { requested_ &= v; update_irq(); return; }
    if (a == 0x00e80004) { pending_mask_ = enabled_; combine(pending_mask_); mask_deadline_ = now_ + 2; return; }
    if (a >= 0x00f00000 && a < 0x00f00010) {
        auto &t = timers_[(a-0x00f00000)/4]; combine(t.value); t.original = t.value;
        t.start = now_; t.deadline = now_ + t.value; t.running = true; return;
    }
    if (a == 0x0098000c) { combine(video_); return; }
    if (a >= 0x10000000 && a < 0x10200000) { render_ = v & 0x4005; return; }
    if (a == 0x00980020 || a == 0x01c00040 || (a & ~0x100000u) == 0x01020000 ||
        (a & ~0x100000u) == 0x01070000) return;
    if (a >= 0x01c00000 && a < 0x01c00020) {
        for (unsigned lane : {0u, 2u}) if (mask & (0xffu << (lane*8)))
            io_write((a-0x01c00000+lane)/2, uint8_t(v >> (lane*8)));
        return;
    }
    if (mapped_device(a)) devices_->write(a, v, mask);
}
void Board::update_irq() {
    constexpr uint32_t masks[] = {1, 2, 0x3fc, 0xc00};
    for (int i = 0; i < 4; ++i) {
        bool value = (requested_ & masks[i]) != 0;
        if (lines_[i] != value) { lines_[i] = value; if (irq) irq(i, value); }
    }
}
void Board::advance(uint64_t ticks) {
    if (ticks > UINT64_MAX - now_) throw std::runtime_error("Board clock overflow");
    uint64_t end = now_ + ticks;
    for (;;) {
        uint64_t next = mask_deadline_;
        for (auto &t : timers_) if (t.running) next = std::min(next, t.deadline);
        if (next > end || next == UINT64_MAX) break;
        now_ = next;
        if (mask_deadline_ == next) {
            enabled_ = pending_mask_; mask_deadline_ = UINT64_MAX;
            if (sound_ready_ && (enabled_ & 0x400)) requested_ |= 0x400;
            update_irq();
        }
        for (size_t i = 0; i < timers_.size(); ++i) {
            auto &t = timers_[i];
            if (!t.running || t.deadline != next) continue;
            if (enabled_ & (1u << (i+2))) requested_ |= 1u << (i+2);
            t.value = 0xfffff; t.running = false; update_irq();
        }
    }
    now_ = end;
}
uint64_t Board::next_event() const {
    uint64_t next = mask_deadline_;
    for (const auto &timer : timers_) if (timer.running) next = std::min(next, timer.deadline);
    return next;
}
void Board::sound_ready(bool ready) {
    sound_ready_ = ready;
    if (ready && (enabled_ & 0x400)) { requested_ |= 0x400; update_irq(); }
}
void Board::vblank(uint64_t frame) {
    frame_ = frame;
    if (enabled_ & 1) { requested_ |= 1; update_irq(); }
}
void Board::copy_buffer(uint32_t *destination) const {
    const auto &bytes = memory_[region(0x900000)->storage];
    for (unsigned i = 0; i < 0x8000; ++i)
        destination[i] = uint32_t(bytes[i*4]) | uint32_t(bytes[i*4+1]) << 8 |
            uint32_t(bytes[i*4+2]) << 16 | uint32_t(bytes[i*4+3]) << 24;
}
uint64_t Board::memory_hash() const {
    uint64_t hash = 14695981039346656037ull;
    for (const auto &bytes : memory_) for (auto v : bytes) hash = (hash ^ v) * 1099511628211ull;
    return hash;
}
std::vector<uint32_t> Board::snapshot() const {
    std::vector<uint32_t> result;
    auto push64 = [&](uint64_t v) { result.push_back(uint32_t(v)); result.push_back(uint32_t(v >> 32)); };
    push64(now_); push64(mask_deadline_); push64(frame_);
    for (uint32_t v : {requested_, enabled_, pending_mask_, video_, render_}) result.push_back(v);
    result.push_back(sound_ready_);
    for (bool v : lines_) result.push_back(v);
    for (auto &t : timers_) { result.push_back(t.value); result.push_back(t.original); push64(t.start); push64(t.deadline); result.push_back(t.running); }
    for (uint8_t v : ports_) result.push_back(v);
    result.push_back(direction_); result.push_back(mode_); result.push_back(analog_channel_); result.push_back(control_mode_);
    result.push_back(uint32_t(xoffset)); result.push_back(uint32_t(yoffset)); result.push_back(zclip);
    auto serial = eeprom.snapshot(); result.insert(result.end(), serial.begin(), serial.end());
    return result;
}
} // namespace von
