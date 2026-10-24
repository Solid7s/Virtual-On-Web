#!/usr/bin/env python3
"""Extract the pinned sound CPU/chip semantics into standalone compiled code.

Only generated build products are written. No MAME device framework is linked.
"""
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path
from prepare_virtual_on_aot import ROOT, original
from prepare_virtual_on_programs import body_of
OUT = ROOT / 'build/v3-standalone'
NOTICE = '// BSD-3-Clause; MAME copyright-holders:Olivier Galibert (68000), ElSemi, R. Belmont (SCSP)\n'


def write(name, data):
    path = OUT / name
    if not path.exists() or path.read_text() != data:
        path.write_text(data)


def prepare_sound():
    prefix = 'src/devices/cpu/m68000/'
    source, header, full, partial, decode = [original(prefix + name) for name in
        ('m68000.cpp', 'm68000.h', 'm68000-sdf.cpp', 'm68000-sdp.cpp', 'm68000-decode.cpp')]
    descriptors = [tuple(int(v, 0) for v in row) for row in re.findall(
        r'\{\s*(0x[0-9a-f]+),\s*(0x[0-9a-f]+),\s*(\d+)\s*\}', decode)]
    handlers = re.findall(r'&m68000_device::(\w+)', full.split('m68000_device::s_handlers_df[] = {', 1)[1])
    rom_source = original('src/mame/sega/model2.cpp')
    sound_metadata = {}
    for setname in ('vonu', 'vonj'):
        with zipfile.ZipFile(ROOT / f'roms/ready/{setname}.zip') as archive:
            members = {Path(name).name.lower(): name for name in archive.namelist()}
            for region, chips, size in (
                ('sound-program', ('epr-18670.31',), 0x80000),
                ('samples', ('mpr-18652.32', 'mpr-18653.34'), 0x400000)):
                data = bytearray()
                for chip in chips:
                    value = archive.read(members[chip])
                    expected = re.search(r'ROM_LOAD16_WORD_SWAP\("' + re.escape(chip) + r'"[^\n]*SHA1\(([0-9a-f]+)\)', rom_source)[1]
                    if len(value) != size or hashlib.sha1(value).hexdigest() != expected:
                        raise RuntimeError('Sound ROM integrity mismatch: ' + chip)
                    swapped = bytearray(len(value)); swapped[0::2], swapped[1::2] = value[1::2], value[0::2]
                    data.extend(swapped)
                target = OUT / (region + '.bin')
                if setname == 'vonj' and target.read_bytes() != data:
                    raise RuntimeError('Regional sound ROMs differ')
                target.write_bytes(data)
                sound_metadata[region] = hashlib.sha256(data).hexdigest()
    # Include ROM callback tables as well as observed execution. Sound commands
    # after a match take indirect paths that attract/first-fight traces omit.
    aot = ROOT / 'build/v3-recompiler'
    aot.mkdir(parents=True, exist_ok=True)
    analyzer = aot / 'm68000-reach'
    if not analyzer.exists():
        recomp = ROOT / 'vendor/daytona-recompiler'
        subprocess.run(['clang++', '-std=c++20', '-O2', '-I' + str(recomp / 'src'),
            str(ROOT / 'scripts/m68000_reach.cpp'), str(recomp / 'src/m68k/decode.cpp'),
            str(recomp / 'src/m68k/reach.cpp'), '-o', str(analyzer)], check=True)
    program = (OUT / 'sound-program.bin').read_bytes()
    pointers = {int.from_bytes(program[i:i+4], 'big') for i in range(0, len(program)-3, 2)}
    pointers = {pc for pc in pointers if 0x600000 <= pc < 0x680000 and not (pc & 1)}
    # Sound command tables contain JMP (d16,PC) instructions, not absolute
    # pointers. Discover those entries (and relative JSRs) before walking their
    # targets, including commands first used during results and later fights.
    relative = set()
    for i in range(0, len(program)-3, 2):
        if program[i:i+2] in (b'\x4e\xfa', b'\x4e\xba'):
            target = 0x600000 + i + 2 + int.from_bytes(program[i+2:i+4], 'big', signed=True)
            if 0x600000 <= target < 0x680000 and not (target & 1):
                relative.add(0x600000 + i)
    entrypoints = json.loads((ROOT / 'runtime/virtual_on/program-entrypoints.json').read_text())
    observed = {int(line, 16) for line in (ROOT / 'runtime/virtual_on/m68000-entrypoints.txt').read_text().splitlines()}
    if (aot / 'm68000-seeds.txt').exists():
        observed.update(int(line, 16) for line in (aot / 'm68000-seeds.txt').read_text().splitlines())
    required_seeds = observed | {int(pc, 16) for pc in entrypoints['m68000']}
    required_file = OUT / 'sound-required-seeds.txt'
    required_file.write_text(''.join(f'{pc:x}\n' for pc in sorted(required_seeds)))
    required = subprocess.check_output([str(aot / 'm68000-reach'), str(OUT / 'sound-program.bin'),
        str(required_file)], text=True)
    required_words = {int(line.split()[1], 16) for line in required.splitlines()}
    seeds = required_seeds | pointers | relative
    seed_file = OUT / 'sound-discovery-seeds.txt'
    seed_file.write_text(''.join(f'{pc:x}\n' for pc in sorted(seeds)))
    result = subprocess.check_output([str(aot / 'm68000-reach'), str(OUT / 'sound-program.bin'),
        str(seed_file)], text=True)
    words = sorted({int(line.split()[1], 16) for line in result.splitlines()})
    programs, rejected = {}, []
    for word in words:
        states = [state for bits, mask, state in descriptors if mask and word & mask == bits]
        if not states:
            if word in required_words:
                raise RuntimeError(f'Unmapped sound opcode {word:04x}')
            # Speculative pointer scans also reach data. Never compile an
            # invalid 68000 encoding; runtime dispatch still fails explicitly
            # if execution actually reaches an unsupported instruction.
            rejected.append(f'{word:04x}')
            continue
        programs[word] = states[0]
    enums = header[header.index('\t// Processor special states'):header.index('\t// Decode table')]
    fields = header[header.index('\t// Internal processor state'):header.index('\t// Typed constructor')]
    # Value-initialize complete state, including comma-separated fields.
    fields = re.sub(r'^(\t(?:u\d+|s\d+|bool|int) )([^;]+);',
        lambda m: m[1] + ', '.join(x.strip() + '{}' for x in m[2].split(',')) + ';', fields, flags=re.M)
    helpers = header[header.index('\t// movem step'):header.rindex('\n};')]
    write('sound_cpu.h', NOTICE + '''#pragma once
#include "sound_support.h"
namespace von {
class SoundCpu {
public:
    SoundBus &bus;
    explicit SoundCpu(SoundBus &b) : bus(b), m_program{*this}, m_opcodes{*this}, m_cpu_space{*this,true} { init_decode_table(); }
    struct Port {
        SoundCpu &cpu; bool vectors = false;
        uint16_t read_interruptible(uint32_t address, uint16_t mask = 0xffff) {
            if (vectors) return 24 + ((address >> 1) & 7);
            return cpu.bus.read(address & 0xffffff, mask, cpu.m_icount);
        }
        void write_interruptible(uint32_t address, uint16_t value, uint16_t mask = 0xffff) {
            cpu.bus.write(address & 0xffffff, value, mask, cpu.m_icount);
        }
    } m_program, m_opcodes, m_cpu_space;
    std::vector<uint16_t> m_decode_table;
    bool m_interrupt_mixer = true;
    NullCallback m_cmpild_instr_callback, m_rte_instr_callback, m_tas_write_callback;
    bool access_to_be_redone() const { return false; }
    void debugger_exception_hook(unsigned) {}
    void debugger_wait_hook() {}
    void reset(); void run(int cycles); void execute_set_input(int inputnum, int state);
    void init_decode_table(); void update_interrupt();
    void start_interrupt_vector_lookup(); void end_interrupt_vector_lookup();
    void update_user_super() { m_sp = (m_sr & SR_S) ? 16 : 15; }
    template<uint16_t opcode, unsigned state> void compiled_full();
    template<uint16_t opcode, unsigned state> void compiled_partial();
    void dispatch(bool partial);
    uint64_t instructions = 0, cycles = 0;
''' + enums + fields + helpers + '\n};\n}\n')
    def adapt(text):
        return text.replace('m68000_device::', 'SoundCpu::').replace('device_reset', 'reset')
    generated = [NOTICE, '#include "sound_cpu.h"', 'namespace von {']
    for signature in ('void m68000_device::device_reset()', 'void m68000_device::execute_set_input(int inputnum, int state)',
                      'void m68000_device::update_interrupt()', 'void m68000_device::set_ftu_const()',
                      'void m68000_device::end_interrupt_vector_lookup()'):
        generated.append(adapt(signature + '{\n' + body_of(source, signature) + '\n}\n'))
    generated.append('''void SoundCpu::start_interrupt_vector_lookup() {
        if ((m_next_state >> 24) == 7) { m_nmi_pending = false; update_interrupt(); }
    }
    void SoundCpu::init_decode_table() {
        m_decode_table.assign(65536, S_ILLEGAL);
''')
    for word, state in programs.items(): generated.append(f'm_decode_table[0x{word:04x}] = {state};')
    generated.append('}')
    for mode, text in [('full', full), ('partial', partial)]:
        generated.append(f'template<uint16_t opcode, unsigned state> void SoundCpu::compiled_{mode}() {{')
        for n, state in enumerate(sorted(set(programs.values()) | set(range(6)))):
            handler = handlers[state] if mode == 'full' else handlers[state][:-2] + 'dp'
            body = body_of(text, f'void m68000_device::{handler}()').replace('m_irdi', 'opcode')
            for label in re.findall(r'^(\w+):', body, re.M):
                body = re.sub(r'\b' + label + r'\b', f's{state}_{label}', body)
            generated.append(f'{"if" if n == 0 else "else if"} constexpr (state == {state}) {{\n{body}\n}}')
        generated.append('}')
    generated.append('''void SoundCpu::dispatch(bool partial) {
        if (m_inst_state < 6) {
            switch (m_inst_state) {''')
    for state in range(6): generated.append(f'case {state}: if (partial) compiled_partial<0,{state}>(); else compiled_full<0,{state}>(); return;')
    generated.append('''} }
        using Run = void(*)(SoundCpu &);
        struct Entry { uint16_t word, state; Run full, partial; };
        static const Entry entries[] = {''')
    for word, state in programs.items():
        generated.append(f'{{0x{word:04x},{state}, [](SoundCpu &c){{ c.compiled_full<0x{word:04x},{state}>(); }}, [](SoundCpu &c){{ c.compiled_partial<0x{word:04x},{state}>(); }}}},')
    generated.append('''};
        static const auto table = [] { std::array<const Entry*,65536> t{}; for (auto &e : entries) t[e.word] = &e; return t; }();
        const auto entry = table[m_irdi];
        if (!entry || entry->state != m_inst_state) fatalerror("Uncompiled sound instruction %04x at %06x state %u", m_irdi, m_ipc, m_inst_state);
        (partial ? entry->partial : entry->full)(*this);
    }
    void SoundCpu::run(int budget) {
        cycles += budget; m_icount = budget - m_count_before_instruction_step;
        m_count_before_instruction_step = 0;
        if (m_icount > 0 && m_inst_substate) dispatch(true);
        while (m_icount > 0) {
            if (m_inst_state >= S_first_instruction) { m_ipc = m_pc-2; m_irdi = m_ird; ++instructions; }
            dispatch(false);
        }
        if (m_icount < 0) m_count_before_instruction_step = -m_icount;
    }
    }''')
    write('sound_cpu.cpp', '\n'.join(generated))
    prepare_scsp()
    write('sound-generation.json', json.dumps({'regions': sound_metadata, 'words': len(programs),
        'romPointerSeeds': len(pointers), 'relativeJumpSeeds': len(relative),
        'explicitEntrypoints': entrypoints['m68000'],
        'rejectedSpeculativeWords': rejected}, indent=2) + '\n')
    return sound_metadata


def prepare_scsp():
    source = original('src/devices/sound/scsp.cpp')
    header = original('src/devices/sound/scsp.h')
    dsp_header = original('src/devices/sound/scspdsp.h')
    dsp_source = original('src/devices/sound/scspdsp.cpp')
    dsp_fields = dsp_header[dsp_header.index('struct SCSPDSP'):dsp_header.index('#endif')]
    dsp_fields = dsp_fields.replace('address_space *space', 'SoundRam *space')
    write('sound_dsp.h', NOTICE + '#pragma once\n#include "sound_support.h"\nnamespace von {\n' + dsp_fields + '\n}\n')
    dsp_source = dsp_source[dsp_source.index('namespace {'):].replace('util::sext', 'sext')
    write('sound_dsp.cpp', NOTICE + '#include "sound_dsp.h"\nnamespace von {\n' + dsp_source + '\n}\n')
    fields = header[header.index('\tenum SCSP_STATE'):header.index('\n};')]
    fields = re.sub(r'^\tdevcb_.*\n', '', fields, flags=re.M)
    fields = fields.replace('\tsound_stream * m_stream;', '')
    fields = fields.replace('emu_timer *m_timerA, *m_timerB, *m_timerC;',
        'SoundTimer *m_timerA = &timers[0], *m_timerB = &timers[1], *m_timerC = &timers[2];')
    fields = re.sub(r'TIMER_CALLBACK_MEMBER\((\w+)\);', r'void \1();', fields)
    # Initialize top-level POD fields/arrays/unions, leaving function declarations.
    fields = re.sub(r'^(\t(?:u\d+|s\d+|int|SCSP_SLOT|SCSPDSP)\s+\*?m_\w+(?:\[[^;]+\])?);', r'\1{};', fields, flags=re.M)
    fields = fields.replace('} m_udata;', '} m_udata{};').replace('} m_dma;', '} m_dma{};')
    fields = fields.replace('sound_stream', 'SoundStream')
    write('sound_chip.h', NOTICE + '''#pragma once
#include "sound_dsp.h"
#define SCSP_FM_DELAY 0
namespace von {
class SoundChip {
public:
    SoundRam &ram;
    uint64_t now = 0, next_sample = 512, midi_due = UINT64_MAX, next_event = 0;
    uint32_t random_state = 0x31415926;
    SoundTimer timers[3]{{now,next_event},{now,next_event},{now,next_event}};
    SoundIrq m_irq_cb;
    std::function<void(uint8_t)> midi_out;
    float gain[2]{};
    std::vector<float> samples;
    explicit SoundChip(SoundRam &r) : ram(r) { init(); }
    uint32_t clock() const { return 22579200; }
    uint8_t read_byte(uint32_t a) { return ram.read_byte(a); }
    uint16_t read_word(uint32_t a) { return ram.read_word(a); }
    uint32_t random() { random_state ^= random_state << 13; random_state ^= random_state >> 17; return random_state ^= random_state << 5; }
    void set_output_gain(unsigned n, double value) { gain[n] = float(value); }
    void m_main_irq_cb(int) {}
    void transmit_register_setup(uint8_t) {
        midi_due = now + (22579200ull * 10 + 31249) / 31250;
        next_event = std::min(next_event, midi_due);
    }
    void receive(uint8_t value) { m_MidiStack[m_MidiW++ & 31] = value; m_MidiW &= 31; CheckPendingIRQ(); }
    uint16_t read(unsigned offset) { return r16(offset*2); }
    void write(unsigned offset, uint16_t value, uint16_t mask = 0xffff) {
        const auto old = r16(offset*2); w16(offset*2, (old & ~mask) | (value & mask));
    }
    // Most CPU bus synchronizations occur before the next sample/timer/MIDI
    // deadline. Scheduling an earlier event lowers this conservative bound.
    void advance(uint64_t target) {
        if (target < next_event) { now = target; return; }
        advance_events(target);
    }
    void advance_events(uint64_t target);
    void tra_complete();
    void sound_stream_update(SoundStream &stream);
''' + fields + '\n};\n}\n')
    constants = source[source.index('#define SHIFT'):source.index('DEFINE_DEVICE_TYPE')]
    # Tables preceding DecodeSCI are part of the instruction-independent chip.
    # The source places envelope tables between timer callbacks and methods.
    chip = source[source.index('u8 scsp_device::DecodeSCI'):source.index('u16 scsp_device::read(offs_t')]
    chip += source[source.index('//LFO handling'):]
    chip = chip.replace('scsp_device::', 'SoundChip::').replace('sound_stream', 'SoundStream').replace('(offs_t)', '(uint32_t)')
    chip = re.sub(r'TIMER_CALLBACK_MEMBER\(SoundChip::(\w+)\)', r'void SoundChip::\1()', chip)
    chip = chip.replace('m_DSP.space = &this->space();', 'm_DSP.space = &ram;')
    chip = re.sub(r'\tm_timer[ABC] = timer_alloc\([^;]+;\n', '', chip)
    chip = chip.replace('attotime::from_ticks(512, time)', '(512ull * clock() + time - 1) / time')
    chip = chip.replace('this->space().write_word', 'ram.write_word')
    chip = chip.replace('machine().rand()', 'random()').replace('machine().describe_context()', '"standalone"')
    stream_update = 'void SoundChip::sound_stream_update(SoundStream &stream) {\n' + body_of(source, 'void scsp_device::sound_stream_update(sound_stream &stream)') + '\n}\n'
    tx = 'void SoundChip::tra_complete() {\n' + body_of(source, 'void scsp_device::tra_complete()') + '\n}\n'
    write('sound_chip.cpp', NOTICE + '#include "sound_chip.h"\nnamespace von {\n' + constants + chip + stream_update + tx + '''
    void SoundChip::advance_events(uint64_t target) {
        for (;;) {
            uint64_t next = std::min(next_sample, midi_due);
            for (auto &timer : timers) next = std::min(next, timer.due);
            if (next > target) { next_event = next; break; }
            now = next;
            if (midi_due == now) {
                midi_due = UINT64_MAX;
                if (midi_out) midi_out(m_MidiOutStack[m_MidiOutR]);
                tra_complete();
            }
            for (unsigned i = 0; i < 3; ++i) if (timers[i].due == now) {
                timers[i].due = UINT64_MAX;
                if (i == 0) timerA_cb(); else if (i == 1) timerB_cb(); else timerC_cb();
            }
            if (next_sample == now) {
                SoundStream stream; sound_stream_update(stream);
                samples.push_back(stream.output[0] * gain[0]); samples.push_back(stream.output[1] * gain[1]);
                next_sample += 512;
            }
        }
        now = target;
    }
    }''')


if __name__ == '__main__':
    prepare_sound()
