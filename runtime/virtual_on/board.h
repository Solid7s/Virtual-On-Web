// SPDX-License-Identifier: BSD-3-Clause
// Model 2B board services. Register semantics derived from MAME model2.cpp
// (R. Belmont, Olivier Galibert, ElSemi, Angelo Salese, Matthew Daniels) and 315_5649.cpp
// (Dirk Best), pinned in the generator manifest. No MAME runtime dependency.
#pragma once
#include "bus.h"
#include "eeprom.h"
#include <array>
#include <functional>
#include <string>
#include <vector>

namespace von {
struct DeviceBoundary : std::runtime_error {
    uint32_t address, value, mask;
    bool writing;
    DeviceBoundary(const char *name, uint32_t a, uint32_t v, uint32_t m, bool w)
        : std::runtime_error(name), address(a), value(v), mask(m), writing(w) {}
};

// Coprocessor, audio and geometry integrations plug in here. An absent device
// is an explicit stop, never guessed read data or a silently discarded write.
class Devices {
public:
    virtual ~Devices() = default;
    virtual uint32_t read(uint32_t a, uint32_t m) { throw DeviceBoundary("device read", a, 0, m, false); }
    virtual void write(uint32_t a, uint32_t v, uint32_t m) { throw DeviceBoundary("device write", a, v, m, true); }
};

class Board final : public Bus {
public:
    explicit Board(std::vector<uint8_t> program, std::vector<uint8_t> data = {});
    uint8_t read_byte(uint32_t) override;
    uint16_t read_word(uint32_t) override;
    uint32_t read_dword(uint32_t) override;
    void write_byte(uint32_t, uint8_t) override;
    void write_word(uint32_t, uint16_t) override;
    void write_dword(uint32_t, uint32_t) override;
    uint16_t flags(uint32_t) const override;
    // Board time is in 25 MHz ticks, independent of host wall-clock pacing.
    void advance(uint64_t ticks);
    void vblank(uint64_t frame);
    bool render_this_frame(uint64_t frame) const { return !(video_ & 1) || !(frame & 1); }
    void copy_buffer(uint32_t *destination) const;
    const uint8_t *memory(uint32_t address) const;
    uint64_t memory_generation(uint32_t address) const;
    void sound_ready(bool ready);
    void attach_devices(Devices &devices) { devices_ = &devices; }
    std::function<void(int, bool)> irq;
    std::function<void()> sync_buffer;
    uint64_t now() const { return now_; }
    uint64_t next_event() const;
    uint64_t memory_hash() const;
    std::vector<uint32_t> snapshot() const;
    std::array<uint8_t, 7> inputs{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff};
    std::array<uint8_t, 8> analog{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff};
    Eeprom eeprom;
    int32_t xoffset = 84, yoffset = 130;
    uint32_t zclip = 0;
    struct Write { uint32_t address, value, mask; bool operator==(const Write &) const = default; };
    // Optional differential-test journal; disabled in the production probe.
    bool journal = false;
    std::vector<Write> writes;
private:
    struct Region {
        uint32_t base, size, offset;
        size_t storage;
        bool readonly, burst;
    };
    struct Timer { uint32_t value = 0xfffff, original = 0; uint64_t start = 0, deadline = 0; bool running = false; };
    std::vector<std::vector<uint8_t>> memory_;
    std::vector<Region> regions_;
    // One region per 64 KiB page; bounds below still handle the short register
    // RAM region. Aliases share the same backing-store generation.
    std::array<uint8_t, 65536> region_pages_{};
    std::vector<uint64_t> memory_generations_;
    const Region *region(uint32_t) const;
    size_t add(uint32_t, uint32_t, uint8_t fill = 0, bool burst = true);
    void alias(uint32_t, uint32_t, size_t, uint32_t offset = 0, bool readonly = false);
    uint32_t read(uint32_t, unsigned);
    void write(uint32_t, uint32_t, unsigned);
    uint32_t device_read(uint32_t, uint32_t);
    void device_write(uint32_t, uint32_t, uint32_t);
    uint8_t io_read(unsigned);
    void io_write(unsigned, uint8_t);
    void update_irq();
    Devices missing_;
    Devices *devices_ = &missing_;
    uint64_t now_ = 0, mask_deadline_ = UINT64_MAX, frame_ = 0;
    uint32_t requested_ = 0, enabled_ = 0, pending_mask_ = 0, video_ = 0, render_ = 0;
    bool sound_ready_ = false;
    std::array<bool, 4> lines_{};
    std::array<Timer, 4> timers_{};
    std::array<uint8_t, 7> ports_{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff};
    uint8_t direction_ = 0xff, mode_ = 0, analog_channel_ = 0;
    bool control_mode_ = false;
};
} // namespace von
