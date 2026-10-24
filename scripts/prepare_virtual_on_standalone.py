#!/usr/bin/env python3
"""Build inputs for the independent Virtual-On runtime; never edits MAME/engines.

Retain the pinned i960 instruction semantics, calls, interrupts and burst stalls,
but remove cpu_device, address_space, machine_config and the MAME scheduler.
Only the test oracle contains execute_op. Production has precompiled handlers
and fails explicitly on an uncompiled PC or modified uploaded instruction.
"""
import collections
import hashlib
import json
import re
import subprocess
import struct
import zipfile
from pathlib import Path
from prepare_virtual_on_aot import ROOT, MAME_COMMIT, RECOMP_COMMIT, original, PROFILES
from prepare_virtual_on_programs import body_of, i960_semantics
from prepare_virtual_on_sharc import prepare_sharc
from prepare_virtual_on_blocks import generate_blocks

OUT = ROOT / 'build/v3-standalone'
AOT = ROOT / 'build/v3-recompiler'
NOTICE = "// MAME BSD-3-Clause; copyright-holders:Farfetch'd, R. Belmont\n"


def adapt(text):
    return (text.replace('i960_cpu_device::', 'I960::')
            .replace('m_program.', 'bus.').replace('m_cache.read_dword', 'bus.read_dword')
            .replace('util::sext', 'sext').replace('device_reset', 'reset'))


def write(name, value):
    path = OUT / name
    if not path.exists() or path.read_text() != value:
        path.write_text(value)


def prepare():
    OUT.mkdir(parents=True, exist_ok=True)
    source = original('src/devices/cpu/i960/i960.cpp')
    header = original('src/devices/cpu/i960/i960.h')
    # Plain architectural fields and declarations only, with an explicit Bus.
    fields = header[header.index('\tvoid burst_stall_save'):header.index('\n};', header.index('\tvoid burst_stall_save'))]
    fields = re.sub(r'^\t(address_space_config|memory_access<).*\n', '', fields, flags=re.M)
    fields = fields.replace('\tvoid execute_op(uint32_t opcode);', '''#ifdef VON_TEST_ORACLE
    void oracle_op(uint32_t opcode);
#endif''')
    # All architectural storage starts deterministic, including IRQ line states.
    fields = re.sub(r'^(\t(?:u?int\d+_t|double|bool|int)\s+m_\w+(?:\[[^;]+\])?);', r'\1{};', fields, flags=re.M)
    fields = fields.replace('}m_stall_state;', '}m_stall_state{};')
    write('i960.h', NOTICE + '''#pragma once
#include "bus.h"
#include <array>
#include <vector>
namespace von {
class FrameRuntime;
void double_to_extended(double, uint32_t *);
double extended_to_double(const uint32_t *);
class I960 {
public:
    static constexpr uint16_t BURST = 1;
    enum { I960_RCACHE_SIZE = 4 };
    Bus &bus;
    explicit I960(Bus &b) : bus(b) {}
    void reset();
    void execute_set_input(int line, int state);
    void standard_irq_callback(int, uint32_t) {}
    void i960_stall() { m_stalled = true; m_IP = m_PIP; }
    void init_program(bool japan);
#ifdef VON_REGISTER_BLOCKS
    unsigned step(FrameRuntime *frames = nullptr, uint64_t next_sound = 0);
    unsigned run_register_block(uint64_t budget);
    bool blocks_enabled = true;
    uint64_t block_instructions = 0;
#else
    unsigned step();
#endif
#ifdef VON_TEST_ORACLE
    unsigned oracle_step();
#endif
    uint64_t instructions = 0, cycles = 0;
    using Handler = void (*)(I960 &);
#ifdef VON_REGISTER_BLOCKS
    struct Block { Handler run; uint16_t ticks, count; };
    unsigned execute_register_block(const Block &block);
#endif
    struct Entry {
        uint32_t pc, word; Handler run;
#ifdef VON_REGISTER_BLOCKS
        const Block *block;
#endif
    };
    const Entry *program = nullptr;
    size_t program_size = 0;
    std::vector<const Entry *> dispatch;
    template<uint32_t opcode> void compiled_op();
    template<uint32_t opcode> static void invoke(I960 &c) { c.compiled_op<opcode>(); }
    std::vector<uint32_t> snapshot() const;
''' + fields + '\n};\n} // namespace von\n#ifdef VON_REGISTER_BLOCKS\n#include "i960_registers.h"\n#endif\n')
    support = source[source.index('uint32_t i960_cpu_device::i960_read_dword_unaligned'):source.index('void i960_cpu_device::execute_op')]
    for signature in ('void i960_cpu_device::execute_set_input(int irqline, int state)',
                      'void i960_cpu_device::device_reset()'):
        support += signature + '\n{' + body_of(source, signature) + '\n}\n'
    prefix = NOTICE + '''#include "i960.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#define DWORD_ALIGNED(a) (((a) & 3) == 0)
#define WORD_ALIGNED(a) (((a) & 1) == 0)
namespace von {
'''
    support = support.replace('static void double_to_extended', 'void double_to_extended')
    support = support.replace('static double extended_to_double', 'double extended_to_double')
    # Make register selection visible to the optimizer: literal operands and
    # register numbers are constants in each precompiled instruction/block.
    registers = []
    for name in ('get_1_ri', 'get_2_ri', 'set_ri', 'cmp_s', 'cmp_u', 'concmp_s', 'concmp_u', 'test'):
        pattern = r'^(?:uint32_t|void) i960_cpu_device::' + name + r'\([^\n]*\)\n\{.*?^\}'
        match = re.search(pattern, support, re.M | re.S)
        if not match:
            raise RuntimeError(f'Missing pinned register helper: {name}')
        registers.append('inline ' + adapt(match[0]))
        support = (support[:match.start()] + '#ifndef VON_REGISTER_BLOCKS\n' + match[0]
                   + '\n#endif' + support[match.end():])
    write('i960_registers.h', NOTICE + '#pragma once\nnamespace von {\n' + '\n'.join(registers) + '\n}\n')
    write('i960_support.cpp', prefix + adapt(support) + '\n}\n')
    semantics = adapt(i960_semantics(source)).replace('aot_op', 'compiled_op')
    semantics = semantics.replace('execute_op(opcode);', 'fatalerror("Uncompiled opcode %08x", opcode);')
    write('i960_semantics.h', prefix.replace('#include "i960.h"', '#pragma once\n#include "i960.h"') + semantics + '\n}\n')
    write('i960_oracle.cpp', prefix + '#ifndef VON_TEST_ORACLE\n#error Test oracle must not ship\n#endif\n'
          + adapt('void i960_cpu_device::oracle_op(uint32_t opcode)\n{' + body_of(source, 'void i960_cpu_device::execute_op(uint32_t opcode)') + '\n}') + '\n}\n')
    corpus = collections.defaultdict(set)
    traces = sorted(AOT.glob('harvest-*-trace.json')) + [AOT / 'installed-play-vonu-6-misses.json']
    traces += sorted(OUT.glob('player-*-misses.json'))
    for path in traces:
        if path.exists():
            for pc, word in json.loads(path.read_text())['trace']['i960']:
                corpus[pc].add(int(word, 16))
    # The live misses extend static discovery without changing the shipping AOT.
    seeds = OUT / 'seeds.txt'
    extra_seeds = OUT / 'player-seeds.txt'
    extra = {int(line, 16) for line in extra_seeds.read_text().splitlines()} if extra_seeds.exists() else set()
    observed = {int(line, 16) for line in (ROOT / 'runtime/virtual_on/i960-entrypoints.txt').read_text().splitlines()}
    extra.update(observed)
    seeds.write_text(''.join(f'{pc:x}\n' for pc in sorted(set(corpus) | extra) if pc < 0x200000))
    profiles, all_words = {}, set()
    metadata = {'mameSemantics': MAME_COMMIT, 'runtime': 'standalone', 'profiles': {}}
    recompiler = ROOT / 'vendor/daytona-recompiler'
    revision = subprocess.check_output(['git', '-C', str(recompiler), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != RECOMP_COMMIT:
        raise RuntimeError('Unexpected reachability analyzer source revision')
    analyzer = OUT / 'i960-reach'
    subprocess.run(['clang++', '-std=c++20', '-O2', '-I' + str(recompiler / 'src'),
        str(ROOT / 'scripts/i960_reach.cpp'),
        *[str(recompiler / f'src/i960/{name}.cpp') for name in ('decode', 'reach', 'isa')],
        '-o', str(analyzer)], check=True)
    rom_source = original('src/mame/sega/model2.cpp')
    for game in PROFILES:
        # Rebuild from the user's archive, never trust a stale extracted program.
        data = bytearray(0x200000)
        with zipfile.ZipFile(ROOT / f'roms/ready/{game}.zip') as archive:
            members = {Path(name).name.lower(): name for name in archive.namelist()}
            for index, chip in enumerate((*PROFILES[game], 'epr-18666.13', 'epr-18667.14')):
                value = archive.read(members[chip])
                expected = re.search(r'ROM_LOAD32_WORD\("' + re.escape(chip) + r'"[^\n]*SHA1\(([0-9a-f]+)\)', rom_source)[1]
                if len(value) != 0x80000 or hashlib.sha1(value).hexdigest() != expected:
                    raise RuntimeError(f'Program ROM integrity mismatch: {chip}')
                offset = (index//2)*0x100000 + (index%2)*2
                for lane in (0, 1):
                    data[offset+lane:offset+0x100000:4] = value[lane::2]
            main_data = bytearray(0x2000000)
            for index, chip in enumerate(('mpr-18648.11', 'mpr-18649.12', 'mpr-18650.9', 'mpr-18651.10')):
                value = archive.read(members[chip])
                expected = re.search(r'ROM_LOAD32_WORD\("' + re.escape(chip) + r'"[^\n]*SHA1\(([0-9a-f]+)\)', rom_source)[1]
                if len(value) != 0x400000 or hashlib.sha1(value).hexdigest() != expected:
                    raise RuntimeError(f'Data ROM integrity mismatch: {chip}')
                offset = (index//2)*0x800000 + (index%2)*2
                for lane in (0, 1):
                    main_data[offset+lane:offset+0x800000:4] = value[lane::2]
            data_path = OUT / 'main-data.bin'
            if game == 'vonj' and data_path.read_bytes() != main_data:
                raise RuntimeError('Regional data ROMs differ')
            if not data_path.exists() or data_path.read_bytes() != main_data:
                data_path.write_bytes(main_data)
            metadata['dataSha256'] = hashlib.sha256(main_data).hexdigest()
            copro_data = bytearray(0x800000)
            for index, chip in enumerate(('mpr-18662.29', 'mpr-18663.30')):
                value = archive.read(members[chip])
                expected = re.search(r'ROM_LOAD32_WORD\("' + re.escape(chip) + r'"[^\n]*SHA1\(([0-9a-f]+)\)', rom_source)[1]
                if len(value) != 0x200000 or hashlib.sha1(value).hexdigest() != expected:
                    raise RuntimeError(f'Coprocessor ROM integrity mismatch: {chip}')
                for lane in (0, 1):
                    copro_data[index*2+lane:0x400000:4] = value[lane::2]
            copro_path = OUT / 'copro-data.bin'
            if game == 'vonj' and copro_path.read_bytes() != copro_data:
                raise RuntimeError('Regional coprocessor ROMs differ')
            if not copro_path.exists() or copro_path.read_bytes() != copro_data:
                copro_path.write_bytes(copro_data)
            metadata['coproDataSha256'] = hashlib.sha256(copro_data).hexdigest()
            for region_name, chips, chip_size in (
                ('polygons', ('mpr-18654.17', 'mpr-18655.21', 'mpr-18656.18', 'mpr-18657.22'), 0x400000),
                ('textures', ('mpr-18660.27', 'mpr-18658.25', 'mpr-18661.28', 'mpr-18659.26'), 0x200000)):
                region_data = bytearray(b'\xff') * 0x1000000
                for index, chip in enumerate(chips):
                    value = archive.read(members[chip])
                    expected = re.search(r'ROM_LOAD32_WORD\("' + re.escape(chip) + r'"[^\n]*SHA1\(([0-9a-f]+)\)', rom_source)[1]
                    if len(value) != chip_size or hashlib.sha1(value).hexdigest() != expected:
                        raise RuntimeError(f'Graphics ROM integrity mismatch: {chip}')
                    offset = (index//2)*0x800000 + (index%2)*2
                    for lane in (0, 1):
                        region_data[offset+lane:offset+chip_size*2:4] = value[lane::2]
                target = OUT / f'{region_name}.bin'
                if game == 'vonj' and target.read_bytes() != region_data:
                    raise RuntimeError(f'Regional {region_name} ROMs differ')
                if not target.exists() or target.read_bytes() != region_data:
                    target.write_bytes(region_data)
                metadata[region_name + 'Sha256'] = hashlib.sha256(region_data).hexdigest()
        binary = OUT / f'{game}.bin'
        if not binary.exists() or binary.read_bytes() != data:
            binary.write_bytes(data)
        # Virtual-On uses ROM-resident callback tables extensively. Every
        # aligned ROM word that points anywhere in program ROM is a conservative
        # discovery seed. Result/next-match callbacks also live below 0x28000;
        # excluding that lower range caused a crash at the first match ending.
        # The decoder still follows instruction boundaries/control flow; this
        # does not add a runtime decoder or interpreter fallback.
        pointers = {value for (value,) in struct.iter_unpack('<I', data)
                    if value < len(data) and not (value & 3)}
        profile_seeds = OUT / f'{game}-discovery-seeds.txt'
        profile_seeds.write_text(seeds.read_text() + ''.join(f'{pc:x}\n' for pc in sorted(pointers)))
        result = subprocess.check_output([str(analyzer), str(binary), str(profile_seeds)], text=True)
        records = {int(pc, 16): {int(word, 16)} for pc, word in (line.split() for line in result.splitlines())}
        # Preserve observed instruction addresses even where static discovery
        # stops. The checked-in address list must reproduce the shipped coverage
        # without requiring the original developer's ignored trace captures.
        for pc in observed:
            if pc < 0x200000:
                records[pc] = {int.from_bytes(data[pc:pc+4], 'little')}
        for pc, words in corpus.items():
            if pc < 0x200000:
                records[pc] = {int.from_bytes(data[pc:pc+4], 'little')}
            elif pc < 0x800000:
                records[pc] = words
        profiles[game] = records
        all_words.update(w for words in records.values() for w in words)
        metadata['profiles'][game] = {'sha256': hashlib.sha256(data).hexdigest(), 'addresses': len(records),
                                     'romPointerSeeds': len(pointers)}
    # Keep generated function IDs stable as newly exercised paths are added.
    # This avoids recompiling every instruction chunk for one new opcode.
    previous = {}
    for chunk in OUT.glob('program_*.cpp'):
        for index, word in re.findall(r'void op_(\d+)\(I960 &c\) \{ c.compiled_op<0x([0-9a-f]+)u>', chunk.read_text()):
            previous[int(index)] = int(word, 16)
    words = [previous[i] for i in sorted(previous)]
    words += sorted(all_words - set(words))
    indexes = {word: index for index, word in enumerate(words)}
    declarations = ['#pragma once', '#include "i960.h"', 'namespace von {']
    for index in range(len(words)):
        declarations.append(f'void op_{index}(I960 &);')
    declarations.append('}')
    write('program_handlers.h', '\n'.join(declarations) + '\n')
    chunks = []
    for start in range(0, len(words), 512):
        name = f'program_{start // 512:03}.cpp'
        text = ['#include "i960_semantics.h"', 'namespace von {']
        for index in range(start, min(start+512, len(words))):
            text.append(f'void op_{index}(I960 &c) {{ c.compiled_op<0x{words[index]:08x}u>(); }}')
        text.append('}')
        write(name, '\n'.join(text) + '\n')
        chunks.append(name)
    block_metadata, block_entries = generate_blocks(profiles, write)
    tables = ['#include "program_handlers.h"', '#ifdef VON_REGISTER_BLOCKS',
              '#include "block_handlers.h"', '#define VON_BLOCK(p) , p', '#else',
              '#define VON_BLOCK(p)', '#endif', 'namespace von {']
    for game, records in profiles.items():
        tables.append(f'static const I960::Entry {game}[] = {{')
        for pc, values in sorted(records.items()):
            for word in sorted(values):
                index = block_entries[game].get(pc)
                block = 'nullptr' if index is None else f'&compiled_blocks[{index}]'
                tables.append(f'{{0x{pc:x}, 0x{word:08x}u, op_{indexes[word]} VON_BLOCK({block})}},')
        tables.append('};')
    tables.append('''void I960::init_program(bool japan) {
    program = japan ? vonj : vonu;
    program_size = japan ? std::size(vonj) : std::size(vonu);
    dispatch.assign(0x80000, nullptr);
    for (size_t i = 0; i < program_size; ++i) {
        const auto &entry = program[i];
        if (entry.pc >= 0x200000) continue;
        if (bus.read_dword(entry.pc) != entry.word)
            fatalerror("Program mismatch at %08x", entry.pc);
        dispatch[entry.pc >> 2] = &entry;
    }
}
}''')
    write('program_tables.cpp', '\n'.join(tables) + '\n')
    metadata.update({'opcodes': len(words), 'sources': ['i960_support.cpp', 'program_tables.cpp', *chunks]})
    metadata['blocks'] = block_metadata
    metadata['sources'] += metadata['blocks']['sources']
    metadata['sharc'] = prepare_sharc(OUT)
    metadata['sources'] += metadata['sharc']['sources']
    # Reuse the pinned Daytona geometrizer and raster/tile semantics.
    for name in ('geo.cpp', 'geo.h', 'fast_paths.h', 'rom_source.h', 'video.cpp', 'video.h',
                 'raster.cpp', 'raster.h', 'raster_texel.h', 'video_profile.h'):
        target = OUT / 'daytona/runtime' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        content = subprocess.check_output(['git', '-C', str(recompiler), 'show',
            f'{RECOMP_COMMIT}:src/runtime/{name}'], text=True)
        if name == 'video.h':
            needle = '    void screen_update(const std::vector<GeoPoly> &polys, int windows, const VideoMem &mem);'
            assert content.count(needle) == 1
            content = content.replace(needle, needle + '''
    // WebGPU decodes/composes System 24 directly from a vblank RAM snapshot.
    // Retain the same polygon frame without decoding or drawing CPU tilemaps.
    void capture_gpu_frame(const std::vector<GeoPoly> &polys, int windows, const VideoMem &mem) {
        gpu_polys_ = &polys; gpu_windows_ = windows; gpu_mem_ = mem;
        rendered_now_ = false;
    }
''')
        if name == 'video.cpp':
            # Our WebGPU ABI consumes composed tile bitmaps. Daytona's newer
            # Vita shortcut hands undecorated pixmaps to GXM instead, leaving
            # those bitmaps empty. Retain the shared CPU tile compositor.
            begin = content.index('bool Video::system24_gpu_compatible() const {')
            end = content.index('\n}', begin) + 2
            content = content[:begin] + '''bool Video::system24_gpu_compatible() const {
    // Virtual-On WebGPU supplies CPU-composed background/foreground layers.
    return false;
}''' + content[end:]
        if not target.exists() or target.read_text() != content:
            target.write_text(content)
    metadata['sources'].append('daytona/runtime/geo.cpp')
    metadata['geometrySource'] = RECOMP_COMMIT
    write('generation.json', json.dumps(metadata, indent=2) + '\n')
    print(json.dumps({k: v for k, v in metadata.items() if k != 'sources'}, indent=2))


if __name__ == '__main__':
    prepare()
