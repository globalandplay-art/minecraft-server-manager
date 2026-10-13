# P7.2b native build preflight

Result: BUILD PREREQUISITES NOT CONFIRMED; native client NOT BUILT. Read-only inspection, no download/install, compiler configuration or native module load. Original pipe primitive PASS is preserved; whole P7.2b remains BLOCKED.

Independent Sol High read-only document review P1/P2/P3=0; reviewer checked wording against supplied query results, not a second execution of tool discovery. Main-thread diff check exit0. No tests/build/typecheck/full regression run for this read-only prerequisites/document slice.

## Observed tools

Current command search: gcc.exe and npm.cmd present; cl.exe, cmake.exe, node-gyp.cmd, python.exe, clang.exe and clang-cl.exe absent. GCC reports MinGW-W64 8.1.0, target x86_64-w64-mingw32; version and target queries exited0. No C/C++ source was compiled. This does not prove GCC cannot compile any addon or that a tool absent from PATH is absent from the computer.

Default vswhere executable absent. Standard Program Files Visual Studio directory absent; Program Files (x86) Visual Studio directory exists but its bounded child-directory query returned no installation entries. Standard Windows Kits10 Include directory absent. These observations cannot exclude a custom installation or other Windows SDK version.

Project-local node-gyp absent, but npm-bundled node-gyp script is present. The earlier command-search result must not be interpreted as node-gyp missing everywhere. No node-gyp configure/install was invoked because it may fetch development artifacts.

Node22.23.1 Node-API header not found in checked bundled runtime include directory or default node-gyp22.23.1 cache. Default cached x64 node.lib absent. No broad filesystem search or user credential/runtime inspection. Headers/import libraries elsewhere remain UNKNOWN.

## Build boundary

[Official node-gyp Windows setup](https://github.com/nodejs/node-gyp#on-windows) specifies Python and Visual C++ build environment. Its development-file fetching is separate from compiling source. Current observations do not establish that supported build route. Existing MinGW8.1 is not substituted for this route without a separate compatibility/build plan and validation. No hand-written Node-API declarations, fabricated import library, copied unknown binary or automatic package/system installation.

NATIVE-BUILD-001: prerequisite blocker for the selected native client slice; no failed build/test was executed, no compiler error or explicit runtime error code. Actual build compatibility UNKNOWN, substantive repair attempts0/2. This is not a product defect or evidence that Windows/Tailscale is broken. No production source changed, no new regression evidence claimed, no commit/push/PR.

## Next steps

Before compiling, establish an existing supported Visual C++/SDK/Python setup or an explicitly approved reproducible alternative; obtain version-matched official Node development artifacts with integrity verification under the chosen build plan. Any system-tool installation is separate from this preflight and was not performed. Then build the bounded isolated transport without real daemon calls, validate module loading and owned mock pipe behavior, and independently review cancellation and endpoint identity.

The authenticated ingress design and deterministic protocol/admission tests are independent work that can continue without native binaries, provided they stay production-unwired and retain existing authentication gates. Native build readiness does not solve the queued-publication/crash-cleanup blocker. Do not enable a provider, weaken TailscaleAtomicBridge, start real Minecraft or enter Cloudflare/Phase7 Final Gate.
