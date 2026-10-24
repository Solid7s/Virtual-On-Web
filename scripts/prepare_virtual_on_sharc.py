#!/usr/bin/env python3
"""Generate a standalone, statically compiled Virtual-On SHARC from pinned semantics.

Only build/ is written. No MAME device, scheduler, address space or interpreter
is linked into production. The optional interpreter is a native test oracle.
"""
import hashlib
import re
from prepare_virtual_on_aot import original
from prepare_virtual_on_programs import body_of


def prepare_sharc(out):
    def write(name, text):
        path = out / name
        if not path.exists() or path.read_text() != text:
            path.write_text(text)

    def adapt(text):
        text = text.replace(' ATTR_COLD', '')
        text = text.replace('adsp21062_device', 'Sharc').replace('offs_t', 'uint32_t')
        text = text.replace('throw emu_fatalerror(', 'fatalerror(').replace('tag()', '"SHARC"')
        text = text.replace('util::sext', 'sext').replace('util::make_bitmask', 'make_bitmask')
        text = text.replace('m_program.read_qword', 'pm_read48').replace('m_program.write_qword', 'pm_write_masked')
        text = text.replace('m_data.read_dword', 'dm_read32').replace('m_data.write_dword', 'dm_write32')
        text = text.replace('m_dm_short_view.select(0);', 'short_signed = true;')
        text = text.replace('m_dm_short_view.disable();', 'short_signed = false;')
        text = text.replace('m_flag_out_cb[i](', 'flag_output(i, ')
        text = text.replace('if (!machine().side_effects_disabled())', '')
        text = text.replace('disassemble_one(m_core->pc, m_core->opcode)', '"no compiled implementation"')
        # DRC-only DMA timers have no place in the instruction-driven runtime.
        text = re.sub(r'\n\tif \(m_enable_drc\)\n\t\{.*?\n\t\}', '', text, flags=re.S)
        return text

    source = original('src/devices/cpu/sharc/sharc.cpp')
    header = original('src/devices/cpu/sharc/sharc.h')
    internal = original('src/devices/cpu/sharc/sharcinternal.ipp')
    ops = original('src/devices/cpu/sharc/sharcops.hxx')
    dma = original('src/devices/cpu/sharc/sharcdma.hxx')
    table = original('src/devices/cpu/sharc/sharcops_table.cpp')
    notice = '// MAME BSD-3-Clause; copyright-holders:Ville Linde\n'
    enums = header[header.index('\tenum ASTAT_SHIFT'):header.index('\nprotected:')]
    constants = header[header.index('\t// ASTAT flags'):header.index('\n\tstruct cfuncs;')]
    structs = header[header.index('\tunion SHARC_REG'):header.index('\n\tstruct alignas(16) sharc_internal_state;')]
    structs = structs.replace('\t\temu_timer *timer;\n', '')
    declarations = header[header.index('\tinline void CHANGE_PC'):header.index('\t// internal compiler state')]
    declarations = declarations.replace('inline ', '')
    core = internal[internal.index('\tSHARC_REG r[16]'):internal.index('\tuint32_t arg0;')]
    core = core.replace('\temu_timer *delayed_iop_timer;\n', '')
    dag = internal[internal.index('\tstruct alignas(16) SHARC_DAG'):internal.index('\tstruct ASTAT_DRC')]
    write('sharc.h', notice + '''#pragma once
#include "sharc_support.h"
namespace von {
class Sharc {
public:
''' + adapt(enums + constants + structs) + '''
    struct alignas(16) sharc_internal_state;
    std::unique_ptr<sharc_internal_state> storage;
    sharc_internal_state *m_core;
    std::array<std::vector<uint32_t>, 2> blocks;
    bool short_signed = false;
    uint64_t cycles = 0, instructions = 0, iop_deadline = UINT64_MAX;
#ifdef VON_SHARC_PROFILE
    std::array<uint64_t, 3679> pc_counts{};
#endif
#ifdef VON_SHARC_MATH
    unsigned run_polynomial();
    uint64_t polynomial_instructions = 0;
#endif
    std::function<uint32_t(uint32_t)> external_read;
    std::function<void(uint32_t, uint32_t)> external_write;
    std::function<void(unsigned, bool)> flag_output = [](unsigned, bool) {};
    Sharc();
    ~Sharc();
    void reset();
    void step(bool oracle = false);
    void execute_instruction(bool oracle);
    bool waiting_for_input() const;
    void set_flag_input(unsigned, bool);
    void external_iop_write(uint32_t, uint32_t);
    void external_dma_write(uint32_t, uint64_t);
    uint32_t iop_r(uint32_t);
    void iop_w(uint32_t, uint32_t);
    void pm_write_masked(uint32_t, uint64_t, uint64_t = 0xffffffffffffull);
    void finish_cycle();
    std::vector<uint32_t> snapshot() const;
    uint64_t memory_hash() const;
    using Handler = void (*)(Sharc &);
    struct Entry { uint64_t word; Handler run; };
    static const Entry program[];
    static const size_t program_size;
    template<uint64_t opcode> void compiled_op();
    template<uint32_t opcode> void compiled_compute();
    template<uint64_t opcode> static void invoke(Sharc &c) { c.compiled_op<opcode>(); }
    void run_compiled(uint32_t instruction_pc);
#ifdef VON_TEST_ORACLE
    void run_oracle();
#endif
    static const uint32_t recips_mantissa_lookup[128];
    static const uint32_t rsqrts_mantissa_lookup[128];
''' + adapt(declarations) + '\n};\nstruct alignas(16) Sharc::sharc_internal_state {\n' +
          adapt(dag + core) + '\n};\n} // namespace von\n')
    helpers = internal[internal.index('// helper functions'):internal.rindex('#endif')]
    floats = internal[internal.index('// constants for IEEE754'):internal.index('struct alignas(16)')]
    support = ''
    for sig in ('void adsp21062_device::CHANGE_PC(uint32_t newpc)',
                'void adsp21062_device::CHANGE_PC_DELAYED(uint32_t newpc)',
                'uint32_t adsp21062_device::iop_r(offs_t offset)',
                'void adsp21062_device::iop_w(offs_t offset, uint32_t data)',
                'void adsp21062_device::external_iop_write(offs_t address, uint32_t data)',
                'void adsp21062_device::external_dma_write(offs_t address, uint64_t data)',
                'void adsp21062_device::check_interrupts()'):
        support += sig + '\n{' + body_of(source, sig) + '\n}\n'
    # Keep helpers; instruction decoding exists only in the native test build.
    oracle_start = ops.index('void adsp21062_device::sharcop_compute_dreg_dm_dreg_pm()')
    compute_sig = 'void adsp21062_device::COMPUTE(uint32_t opcode)'
    compute_body = body_of(ops, compute_sig)
    compute_full = compute_sig + '\n{' + compute_body + '\n}'
    common_ops = ops[:oracle_start].replace(compute_full, '#ifdef VON_TEST_ORACLE\n' + compute_full + '\n#endif')
    descriptors = re.findall(r'\{\s*(0x[0-9a-f]+),\s*(0x[0-9a-f]+),\s*&adsp21062_device::(\w+)', table)
    translated = ['template<uint32_t opcode> __attribute__((always_inline)) inline void Sharc::compiled_compute() {', adapt(compute_body), '}',
                  'template<uint64_t opcode> void Sharc::compiled_op() {']
    for i, (mask, bits, handler) in enumerate(descriptors):
        body = body_of(ops, f'void adsp21062_device::{handler}()')
        body = body.replace('m_core->opcode', 'opcode').replace('COMPUTE(compute);', 'compiled_compute<compute>();')
        translated.append(f'{"if" if i == 0 else "else if"} constexpr (((opcode >> 32) & {mask}) == {bits}) {{\n{adapt(body)}\n}}')
    translated += ['else sharcop_unimplemented();', '}']
    # The image was identified independently in the previous AOT work. Verify
    # it directly in both freshly extracted ROMs instead of trusting build output.
    image_base, image_bytes = 1488268, 3679 * 6
    image = (out / 'vonu.bin').read_bytes()[image_base:image_base + image_bytes]
    expected = '6ab3490a1bf66998ba390be49823b521066bcbdaf38462ffaf215113e0996302'
    if hashlib.sha256(image).hexdigest() != expected or image != (out / 'vonj.bin').read_bytes()[image_base:image_base + image_bytes]:
        raise RuntimeError('Unexpected SHARC upload image')
    words = [int.from_bytes(image[i:i+6], 'little') for i in range(0, len(image), 6)]
    translated += ['const Sharc::Entry Sharc::program[] = {']
    translated += [f'{{0x{word:012x}ull, &invoke<0x{word:012x}ull>}},' for word in words]
    translated += ['};', 'const size_t Sharc::program_size = sizeof(program) / sizeof(program[0]);']
    oracle = ['#ifdef VON_TEST_ORACLE', adapt(ops[oracle_start:]), 'void Sharc::run_oracle() {']
    for i, (mask, bits, handler) in enumerate(descriptors):
        oracle.append(f'{"if" if i == 0 else "else if"} (((m_core->opcode >> 32) & {mask}) == {bits}) {handler}();')
    oracle += ['else sharcop_unimplemented();', '}', '#else', 'void Sharc::sharcop_unimplemented() { fatalerror("Unsupported SHARC opcode at %08x", m_core->pc); }', '#endif']
    dma_support = dma[:dma.index('void adsp21062_device::dma_op(int channel)')]
    sig = 'void adsp21062_device::sharc_dma_exec(int channel)'
    dma_support += sig + '\n{' + body_of(dma, sig) + '\n}\n'
    write('sharc_compute.inc', adapt(original('src/devices/cpu/sharc/compute.hxx')))
    text = notice + '#include "sharc.h"\nnamespace von {\n' + adapt(floats + helpers + support + dma_support + common_ops)
    text = text.replace('#include "compute.hxx"', '#include "sharc_compute.inc"')
    execution = source[source.index('\t\t\tm_core->pc = m_core->daddr;', source.index('void adsp21062_device::execute_run()')):]
    execution = execution[:execution.index('\t\t\t--m_core->icount;')]
    execution = execution.replace('debugger_instruction_hook(m_core->pc);', '')
    execution = execution.replace('m_core->opcode = m_program.read_qword(m_core->pc);',
        'const uint32_t instruction_pc = m_core->pc;\n            m_core->opcode = m_program.read_qword(instruction_pc);')
    execution = execution.replace('(this->*m_sharc_op[(m_core->opcode >> 39) & 0x1ff])();', '''
#ifdef VON_TEST_ORACLE
            if (oracle) run_oracle(); else
#endif
            run_compiled(instruction_pc);''')
    text += '\n' + '\n'.join(translated + oracle) + '\nvoid Sharc::execute_instruction(bool oracle) {\n' + adapt(execution) + '\n}\n}\n'
    text = text.replace('inline ', '')  # helpers also called from sharc_runtime.cpp
    text = text.replace('LOG(', 'logerror(')
    if words[0xdd8:0xdda] != [0x6e7e091304c4, 0x013e00081424]:
        raise RuntimeError('SHARC polynomial specialization no longer matches the program')
    text += '\n#ifdef VON_SHARC_MATH\n#include "sharc_polynomial.inc"\n#endif\n'
    write('sharc_program.cpp', text)
    return {'sources': ['sharc_program.cpp'], 'imageSha256': expected, 'instructions': len(words),
            'compiledWords': len(set(words)), 'interpreter': 'native test build only'}
