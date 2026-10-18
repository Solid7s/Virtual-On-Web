// SPDX-License-Identifier: BSD-3-Clause
// 93C46 64x16 serial EEPROM. Behavior follows MAME eepromser.cpp/eeprom.cpp
// (Aaron Giles), including streaming reads, dummy bit, locking and busy timing.
#pragma once
#include <array>
#include <cstdint>
#include <vector>

namespace von {
class Eeprom {
public:
    Eeprom() { words.fill(0xffff); }
    std::array<uint16_t, 64> words;
    // The board writes DI, CLK, then CS, in that order.
    void pins(uint8_t value, uint64_t now) {
        const bool clock = (value & 0x80) != 0, select = (value & 0x40) != 0;
        if (clock && !clock_) rising((value & 0x20) != 0, now);
        clock_ = clock;
        if (select != selected_) { state_ = select ? Start : Reset; if (select) select_time_ = now; }
        selected_ = select;
    }
    bool output(uint64_t now) const {
        if (state_ == Start) return now >= busy_until_;
        if (state_ == Read) return (shift_ >> 31) != 0;
        return true;
    }
    std::vector<uint32_t> snapshot() const {
        std::vector<uint32_t> v(words.begin(), words.end());
        for (uint32_t x : {uint32_t(state_), uint32_t(clock_), uint32_t(selected_), uint32_t(locked_),
            command_, address_, bits_, shift_, uint32_t(busy_until_), uint32_t(busy_until_ >> 32),
            uint32_t(select_time_), uint32_t(select_time_ >> 32)}) v.push_back(x);
        return v;
    }
private:
    enum State { Reset, Start, Command, Read, Data, Complete } state_ = Reset;
    bool clock_ = false, selected_ = false, locked_ = true;
    uint32_t command_ = 0, address_ = 0, bits_ = 0, shift_ = 0;
    uint64_t busy_until_ = 0, select_time_ = 0;
    void rising(bool bit, uint64_t now) {
        switch (state_) {
        case Reset: case Complete: break;
        case Start:
            if (bit && now >= busy_until_ && now > select_time_) { state_ = Command; command_ = bits_ = 0; }
            break;
        case Command:
            command_ = (command_ << 1) | bit;
            if (++bits_ != 8) break;
            bits_ = shift_ = 0; address_ = command_ & 63;
            switch (command_ >> 6) {
            case 2: state_ = Read; break;
            case 1: state_ = Data; break;
            case 3:
                if (locked_) state_ = Reset;
                else { words[address_] = 0xffff; busy_until_ = now + 25000; state_ = Complete; }
                break;
            case 0:
                switch (address_ >> 4) {
                case 0: locked_ = true; state_ = Reset; break;
                case 1: state_ = Data; break;
                case 2:
                    if (locked_) state_ = Reset;
                    else { words.fill(0xffff); busy_until_ = now + 200000; state_ = Complete; }
                    break;
                case 3: locked_ = false; state_ = Reset; break;
                }
                break;
            }
            break;
        case Read: {
            unsigned index = bits_++;
            if (index % 16 == 0) shift_ = uint32_t(words[(address_ + bits_/16) & 63]) << 16;
            else shift_ = (shift_ << 1) | 1;
            break;
        }
        case Data:
            shift_ = (shift_ << 1) | bit;
            if (++bits_ != 16) break;
            if (locked_) state_ = Reset;
            else {
                if ((command_ >> 6) == 0) words.fill(uint16_t(shift_));
                else words[address_] = uint16_t(shift_);
                busy_until_ = now + ((command_ >> 6) == 0 ? 200000 : 43750);
                state_ = Complete;
            }
            break;
        }
    }
};
} // namespace von
