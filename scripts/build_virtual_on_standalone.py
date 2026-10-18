#!/usr/bin/env python3
"""Build a native or Wasm standalone boot probe without any MAME libraries."""
import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from prepare_virtual_on_standalone import ROOT, OUT, prepare


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wasm', action='store_true')
    parser.add_argument('--oracle', action='store_true', help='native-only differential test, never shipped')
    parser.add_argument('--jobs', type=int, default=3)
    parser.add_argument('--sharc-test', action='store_true', help='build isolated SHARC bus replay test')
    parser.add_argument('--player', action='store_true', help='build standalone interactive runtime')
    parser.add_argument('--variant', default='', help='isolated local candidate suffix')
    parser.add_argument('--profiling', action='store_true', help='retain Wasm function names for CPU profiles')
    args = parser.parse_args()
    if args.variant and not re.fullmatch(r'[a-z0-9-]+', args.variant):
        parser.error('Variant must contain only lowercase letters, digits and hyphens.')
    if args.wasm and args.oracle:
        parser.error('The interpreter oracle is test-only; do not link it into Wasm.')
    prepare()
    kind = 'wasm' if args.wasm else 'oracle' if args.oracle else 'native'
    if args.sharc_test:
        kind = 'sharc-' + kind
    if args.player:
        kind = 'player-' + kind
    if args.variant:
        kind += '-' + args.variant
    build = OUT / kind
    build.mkdir(exist_ok=True)
    sdk = (ROOT / 'tools/emsdk').resolve()
    compiler = str(sdk / 'upstream/emscripten/em++') if args.wasm else 'clang++'
    env = dict(os.environ, EMSDK=str(sdk), EM_CONFIG=str(sdk / '.emscripten'),
               EMSDK_PYTHON=sys.executable)
    # Legacy JS exception emulation wraps hot indirect CPU calls in JS invoke_*
    # trampolines. Native Wasm EH keeps the player's dispatch inside Wasm and
    # still catches explicit unsupported-code/device errors at the host boundary.
    native_wasm_eh = args.wasm and args.player
    common = [compiler, '-std=c++20', '-O2', '-fno-fast-math', '-ffp-contract=off',
              '-fwasm-exceptions' if native_wasm_eh else '-fexceptions',
              '-I' + str(ROOT / 'runtime/virtual_on'), '-I' + str(OUT), '-I' + str(OUT / 'daytona')]
    if args.oracle:
        common.append('-DVON_TEST_ORACLE')
    metadata = json.loads((OUT / 'generation.json').read_text())
    if args.player:
        from prepare_virtual_on_sound import prepare_sound
        metadata['soundRegions'] = prepare_sound()
        (OUT / 'generation.json').write_text(json.dumps(metadata, indent=2) + '\n')
    sources = [OUT / name for name in metadata['sources']]
    sources += [ROOT / f'runtime/virtual_on/{name}.cpp' for name in ('i960_runtime', 'sharc_runtime', 'board', 'probe')]
    if args.player:
        sources[-1] = ROOT / 'runtime/virtual_on/player.cpp'
        sources += [OUT / f'daytona/runtime/{name}.cpp' for name in ('video', 'raster')]
        sources += [OUT / f'{name}.cpp' for name in ('sound_cpu', 'sound_chip', 'sound_dsp')]
    if args.oracle:
        sources.append(OUT / 'i960_oracle.cpp')
    if args.sharc_test:
        sources = [OUT / 'sharc_program.cpp', ROOT / 'runtime/virtual_on/sharc_runtime.cpp', ROOT / 'tests/virtual-on-sharc.cpp']
    def local_headers(source, seen=None):
        seen = set() if seen is None else seen
        for name in re.findall(r'^#include "([^"]+)"', source.read_text(), re.M):
            candidates = [source.parent / name, ROOT / 'runtime/virtual_on' / name, OUT / name, OUT / 'daytona' / name]
            header = next((p for p in candidates if p.exists()), None)
            if header is not None and header not in seen:
                seen.add(header)
                local_headers(header, seen)
        return sorted(seen)

    def compile_one(source):
        obj = build / (source.stem + '.o')
        stamp = obj.with_suffix('.hash')
        headers = b''.join(p.read_bytes() for p in local_headers(source))
        digest = hashlib.sha256(source.read_bytes() + headers + repr(common).encode()).hexdigest()
        if obj.exists() and stamp.exists() and stamp.read_text() == digest:
            return obj
        result = subprocess.run([*common, '-c', str(source), '-o', str(obj)], env=env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (build / (source.stem + '.log')).write_text(result.stdout)
        if result.returncode:
            raise RuntimeError(f'{source.name}:\n{result.stdout[-5000:]}')
        stamp.write_text(digest)
        print(f'Compiled {source.name}', flush=True)
        return obj

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        objects = list(pool.map(compile_one, sources))
    target = build / ('virtual-on-standalone.cjs' if args.wasm else 'virtual-on-probe')
    link = [*common, *map(str, objects), '-o', str(target)]
    if args.wasm:
        link += ['-sMODULARIZE=1', '-sEXPORT_NAME=createVirtualOnStandalone', '-sENVIRONMENT=node,web',
                 '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=67108864', '-sFORCE_FILESYSTEM=1',
                 # Chrome's TextDecoder rejects views over resizable buffers.
                 # Keep ordinary Wasm memory growth and refresh the heap views.
                 '-sGROWABLE_ARRAYBUFFERS=0',
                 '-sSTACK_SIZE=1048576', '-sSTACK_OVERFLOW_CHECK=2',
                 '-sINVOKE_RUN=0', '-sEXPORTED_RUNTIME_METHODS=["FS","callMain","ccall","UTF8ToString","HEAPU8","HEAPF32"]']
        if not native_wasm_eh:
            link.append('-sDISABLE_EXCEPTION_CATCHING=0')
        if args.profiling:
            link.append('--profiling-funcs')
    result = subprocess.run(link, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (build / 'link.log').write_text(result.stdout)
    if result.returncode:
        raise RuntimeError(result.stdout[-5000:])
    manifest = {'kind': kind, 'mameRuntimeLinked': False, 'interpreterLinked': args.oracle,
                'generation': metadata, 'sources': [str(p.relative_to(ROOT)) for p in sources],
                'linkCommand': link,
                'artifacts': {target.name: hashlib.sha256(target.read_bytes()).hexdigest()}}
    if args.wasm:
        wasm = target.with_suffix('.wasm')
        manifest['artifacts'][wasm.name] = hashlib.sha256(wasm.read_bytes()).hexdigest()
        manifest['wasmBytes'] = wasm.stat().st_size
    (build / 'build.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Built {target}', flush=True)


if __name__ == '__main__':
    main()
