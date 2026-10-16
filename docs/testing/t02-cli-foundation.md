# T02 — CLI foundation evidence

Date: 2026-10-16 UTC. Branch: `feat/module-01-brand-runtime`; base: `8e9e57c`. Scope: only T02. Independent review accepted the code without defects; the coordinator separately confirmed 33/33 portable tests, valid version JSON and clean whitespace checks. Local T02 commit authorized after review. No dependency installation, package build, publication, push or T03 work.

## Environment and support boundary

Commands executed in the cloud Linux x64 workspace returned Node `v24.19.0` and npm `11.9.0`. This differs from the qualified Windows x64 Node `24.21.0` / npm `11.19.0`. The package declares exact Node `24.21.0`; running portable read-only help/version tests here does not qualify another platform/runtime or prove npm installation. npm emitted its existing environment warning about unknown `http-proxy` config; no npm settings were changed.

## Red → green

1. Added `tests/unit/cli-foundation.test.mjs` before any executable or domain/interface implementation. Ran `node --test tests/unit/cli-foundation.test.mjs`: **33 tests, 0 pass, 33 fail**. Expected failures included the old package name and missing entrypoint/modules. The shell captured the failing report and printed its tail; that initial shell wrapper's final status was from `tail`, not the test process. No green claim is inferred from that wrapper status.
2. Implemented the CLI modules and package metadata. First rerun had 3 help assertions fail: the help sentence used the ordinary noun “workspace”, which the strict no-future-command test rejected. Changed the sentence to “Nenhum diretório de dados é criado.”
3. Ran `node --test --test-reporter=tap tests/unit/cli-foundation.test.mjs`: **33 pass, 0 fail, 0 skipped; exit 0**. Repeated after final metadata assertion: same result.
4. Ran actual `npm test` (`node --test`): **33 pass, 0 fail, 0 skipped; exit 0**. This verifies recursive discovery of the nested portable suite and exclusion of the explicitly named native qualification fixture.
5. Ran `node bin/peterson-carousel.mjs --help`, `node bin/peterson-carousel.mjs --version`, and `node bin/peterson-carousel.mjs --version --json`: expected help/version/envelope, no native dependencies installed. The version JSON was:

```json
{"protocolVersion":1,"ok":true,"data":{"name":"@pb/carousel-harness","version":"0.1.0"},"error":null,"nextAction":null}
```

Tests exercise the executable in child processes (using the current Node), readable help/version and aliases, default help, JSON flag ordering, strict envelope fields, a single JSON stdout result, separate stderr diagnostics, usage errors returning 2, sanitization, duplicate/unknown/conflicting flags, unavailable commands, foreign cwd with spaces/accents, absent workspace/cache paths, and a minimal copy containing only `bin`, `src`, and `package.json` with no native dependencies/resources. The internal-error unit case verifies mapping to exit code 1 and safe output; it does not simulate a real process/storage failure. Exit code 0 is success, 2 is invalid usage, 1 is unexpected internal failure.

## Protocol and scope

Protocol version is the integer `1`. All results contain `protocolVersion`, `ok`, `data`, `error`, `nextAction`. Successful help/version have null error and nextAction. Errors have null data and a public `{code, message}`; invalid usage suggests `peterson-carousel --help`. Input values and stack traces are never echoed in errors. Only exact `--json` selects JSON, including when other arguments fail validation. Malformed options such as `--json=true` are invalid rather than silently accepted.

Only help/version exist, plus `--json`, `-h`, `-v`. No-argument invocation displays help. Unknown positional commands and unimplemented `--data-dir`/`--yes` are rejected. Help does not advertise brand/run/doctor/init/workspace/approval commands. No initialization, configuration lookup, database, native import, renderer, cache, dependency loading, or mutable operation is implemented.

## Qualification categorization

The original T01 file was renamed from `tests/qualification/native-runtime.test.mjs` to `tests/qualification/native-runtime.qualification.mjs`, preserving all bytes and strict assertions. SHA-256 before and after:

`7fe70b28a5b5588a93a35925005b2dd2b0e82f63318ad3d82c4577fe33ebe37d`

The explicit current command is `npm run test:qualification`, or `node --test tests/qualification/native-runtime.qualification.mjs`. It requires the qualified Windows environment and its separate native dependencies. No native qualification was run here; portable test success does not include or replace it. Original Windows command paths remain historical evidence; the runtime matrix notes the new path. No conditional skip or weakened platform/version assertions were introduced.

## Integrity checks

- Compared renamed qualification bytes against `git show HEAD:tests/qualification/native-runtime.test.mjs`: identical.
- Parsed old/new product lockfiles and compared every non-root `packages` entry: identical. Root dependency declarations unchanged. Only root name/bin/engines metadata changed; no lockfile regeneration or installation.
- Verified no product `node_modules` directory exists.
- Entrypoint has Unix mode `0755` and Node shebang. npm's Windows command shim is not tested here; that belongs to the authorized installation/distribution tasks.
- Existing renderer, templates, assets, fonts, configuration, dependency declarations and historical qualification sandbox manifests remain untouched.

No product-wide or Windows completion is claimed. T03 and subsequent tasks require separate authorization.
