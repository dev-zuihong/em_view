# EMView Tauri

Rust Tauri port of the original WinUI `emview` project.

## Requirements

- Node.js 20.11+ works with the pinned Vite 5 toolchain in this project.
- Rust stable toolchain with Cargo is required for Tauri, Rust tests, and desktop packaging.
- On Windows, install the Tauri prerequisites listed in the official Tauri v2 setup guide.

## Commands

```powershell
npm install
npm run build
npm run tauri:dev
```

Rust checks, once Cargo is available:

```powershell
cd src-tauri
cargo test
cargo run --bin emview-tauri
```

## Parser Scope

- `.map`: Keil MAP and GNU ld MAP parsing, including overview, object rows, symbols, removed sections, library rows, and Keil cross references.
- `.axf` / `.elf`: basic ELF/AXF parsing from sections and symbols. Overview, section/object rows, symbols, and basic library grouping are available. Dead-code and dependency analysis are disabled because AXF files do not reliably carry the same linker report data as MAP files.

The local regression samples used during migration are expected at:

- `X:\WINUI3\STD_Mouse_Solution.map`
- `X:\WINUI3\STD_Mouse_Solution.axf`
