# Third-party software

The standalone player reuses individually licensed instruction and hardware
semantics without linking the full MAME framework. The exact source files,
copyright holders, adaptation scope, and full BSD-3-Clause conditions are in
[runtime/virtual_on/THIRD_PARTY.md](runtime/virtual_on/THIRD_PARTY.md).

- **MAME:** pinned source revision `f9b2a9da4e937468fdd9099e8316e6ad40659f86`.
  [Upstream](https://github.com/mamedev/mame). The relevant individually
  BSD-3-Clause CPU, video, sound, and board files are identified in the runtime notice.
- **daytona-arcade-recomp:** revision `b33baeb28a1e1c94d90a4a80811f0b2c7f61106b`.
  [Upstream](https://github.com/alphanu1/daytona-arcade-recomp). Used for offline
  analysis and geometry/raster/tile semantics. Copyright (c) 2026, Ben Templeman
  and contributors. [License](licenses/DAYTONA_LICENSE.txt) and
  [upstream attribution record](licenses/DAYTONA_THIRD_PARTY.md) are preserved.
  That upstream record covers additional platforms and dependencies which are
  not all linked into this standalone Virtual-On player.
- **Emscripten 6.0.2:** builds the WebAssembly engine and JavaScript runtime glue.
  [License and bundled notices](licenses/EMSCRIPTEN_LICENSE.txt);
  [authors](licenses/EMSCRIPTEN_AUTHORS.txt).
- **Playwright 1.59.1:** browser testing only; not shipped as a website runtime
  dependency. Apache-2.0; its installed package includes its license.

The Model 2 game catalog is derived from the pinned MAME `model2.cpp` driver.
Shared frontend helpers originated in the earlier Daytona/Model 2 web port;
the original BSD license is retained in [LICENSE](LICENSE).

Game programs and artwork are separate from these software licenses. See
[NOTICE.md](NOTICE.md).
