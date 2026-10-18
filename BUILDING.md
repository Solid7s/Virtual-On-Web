# Offline engine builds

The repository includes the tested precompiled player. Serving the website does
not require rebuilding it, downloading MAME, or installing Emscripten.

The build scripts translate user-supplied arcade CPU programs into C++ and then
WebAssembly. They are developer tooling for macOS/Linux with Python 3, Git,
Clang with C++20 support, and Emscripten 6.0.2. Generated files remain in ignored
`build/` directories, apart from the three explicitly shipped player artifacts.

## Dependencies

Use these exact upstream source revisions:

```sh
mkdir -p vendor tools roms/ready
git clone https://github.com/mamedev/mame.git vendor/mame
git -C vendor/mame checkout f9b2a9da4e937468fdd9099e8316e6ad40659f86
git clone https://github.com/alphanu1/daytona-arcade-recomp.git vendor/daytona-recompiler
git -C vendor/daytona-recompiler checkout b33baeb28a1e1c94d90a4a80811f0b2c7f61106b
git clone https://github.com/emscripten-core/emsdk.git tools/emsdk
tools/emsdk/emsdk install 6.0.2
tools/emsdk/emsdk activate 6.0.2
```

Place your complete USA and Japan Revision B ZIPs at `roms/ready/vonu.zip` and
`roms/ready/vonj.zip`. Both regions are compiled into the player. Archives must
contain the shared data as well as the regional CPU programs. Do not commit them.

```sh
python3 scripts/build_virtual_on_standalone.py --player --wasm
```

The address-only entrypoint lists in `runtime/virtual_on/` retain discovery
coverage from development. Instruction words and graphics/audio data are read
from the supplied ROMs. The generator may also incorporate additional local
traces if present. Compiler versions and discovery inputs can change binary
hashes; this is not a claim of byte-for-byte reproducible builds.

The shipped manifest records the actual release engine hashes. A rebuilt engine
must be validated independently, including first-match progression. The public
release packaging does not recompile the already validated engine.

## Website deployment

`npm run build:site` checks the engine hashes and copies only `site-files.json`
entries into `_site/`. It strips local compiler command paths from the deployed
manifest. It rejects symlinks and ROM/archive paths. GitHub Actions runs the unit
tests and this packaging step, then deploys `_site/` to GitHub Pages.

Keep the notices and licenses in the deployed site. Before committing a rebuilt
`build.json`, remove its local `linkCommand` field; it can contain machine paths.
