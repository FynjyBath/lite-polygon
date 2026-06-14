# Compatibility with Codeforces Polygon

This document describes what is and is not compatible with the real [Codeforces Polygon](https://polygon.codeforces.com), covering the REST API, package format, and behaviour differences.

---

## REST API Methods

All endpoints follow the Polygon convention: `GET /api/{methodName}` or `POST /api/{methodName}`, returning `{"status":"OK","result":...}` or `{"status":"FAILED","comment":"..."}`.

### Implemented

| Method | Notes |
|---|---|
| `auth/login` | Session cookie |
| `auth/logout` | |
| `auth/register` | Local only; Polygon has no public register |
| `auth/me` | |
| `auth/changePassword` | |
| `auth/generateApiKey` | Returns apiKey + apiSecret |
| `problems.list` | Returns problems owned by current user |
| `problem.create` | |
| `problem.info` | |
| `problem.updateInfo` | time/memory limit, I/O files, run count, CPU info |
| `problem.statements` | |
| `problem.saveStatement` | |
| `problem.renderStatements` | Plain-text sections only; no LaTeX rendering |
| `problem.statementResources` | |
| `problem.saveStatementResource` | Multipart file upload |
| `problem.viewGeneralDescription` | |
| `problem.viewGeneralTutorial` | |
| `problem.files` | Resources + executables |
| `problem.saveFile` | |
| `problem.viewFile` | Raw file download |
| `problem.checker` | |
| `problem.setChecker` | |
| `problem.checkerTests` | |
| `problem.saveCheckerTest` | |
| `problem.validator` | |
| `problem.setValidator` | |
| `problem.validatorTests` | |
| `problem.saveValidatorTest` | |
| `problem.interactor` | |
| `problem.setInteractor` | |
| `problem.tests` | |
| `problem.saveTest` | manual or generated (cmd) |
| `problem.deleteTest` | Shifts subsequent indices |
| `problem.testInput` | Raw download |
| `problem.testAnswer` | Raw download |
| `problem.previewTests` | First 256 bytes of input |
| `problem.viewTestGroup` | |
| `problem.saveTestGroup` | Points, policies, dependencies |
| `problem.enableGroups` | |
| `problem.enablePoints` | |
| `problem.solutions` | |
| `problem.saveSolution` | |
| `problem.viewSolution` | |
| `problem.packages` | |
| `problem.buildPackage` | Async; poll `problem.packages` for state |
| `problem.package` | ZIP download |
| `problem.importPackage` | Multipart upload; `?overwrite=true` to replace |
| `problem.invocations` | |
| `problem.runInvocation` | Async; solution × test matrix |
| `problem.invocationResults` | |
| `problem.stresses` | |
| `problem.saveStress` | |
| `problem.viewTags` | |
| `problem.saveTags` | Comma-separated list |
| `problem.cautions` | Returns `aiTips: []` always |
| `problem.commitChanges` | Increments revision, clears modified flag |

### Not implemented

| Method | Reason |
|---|---|
| `problem.aiTips` | Explicitly disabled; always returns `[]` |
| `problem.messages` / `problem.addMessage` | No review/collaboration system |
| `problem.access` / `problem.setAccess` | No sharing — single-owner model |
| `problems.search` | No search; full list is returned |
| `contest.*` | No contest management |

---

## apiSig Authentication

The `apiSig` scheme is **identical** to Codeforces Polygon:

```
rand   = 6 random lowercase hex chars (3 random bytes)
params = all query/body params sorted lexicographically by key then value (apiSig excluded)
payload = "${rand}/${methodName}?${sorted_params}#${apiSecret}"
apiSig  = rand + SHA-512(payload)
```

Time window: ±300 seconds.

One difference from Polygon: the API secret is stored bcrypt-hashed in the database (Polygon stores it in plaintext on their servers). This means you can only verify a secret, not retrieve it — consistent with the UI flow where the secret is shown once at generation time.

---

## Package Format

### problem.xml — Supported Elements

| Element | Round-trip | Import | Export |
|---|---|---|---|
| `<problem revision short-name url>` | ✓ | ✓ | ✓ |
| `<names><name language value>` | ✓ | ✓ | ✓ |
| `<statements><statement language path type charset mathjax>` | ✓ | ✓ | ✓ |
| `<tutorials><tutorial ...>` | ✓ | ✓ | ✓ |
| `<judging input-file output-file run-count cpu-name cpu-speed>` | ✓ | ✓ | ✓ |
| `<testset name time-limit memory-limit test-count input-path-pattern answer-path-pattern>` | ✓ | ✓ | ✓ |
| `<tests><test method cmd sample group points description>` | ✓ | ✓ | ✓ |
| `<groups><group name points points-policy feedback-policy>` | ✓ | ✓ | ✓ |
| `<dependencies><dependency group>` | ✓ | ✓ | ✓ |
| `<files><resources><file path type for-types stages assets main>` | ✓ | ✓ | ✓ |
| `<executables><executable><source><binary>` | ✓ | ✓ | ✓ |
| `<assets><checker name type><source><binary><copy><testset>` | ✓ | ✓ | ✓ |
| `<validators><validator><testset><tests><test verdict testset group>` | ✓ | ✓ | ✓ |
| `<interactor><runs><run>` | ✓ | ✓ | ✓ |
| `<solutions><solution tag><source><binary>` | ✓ | ✓ | ✓ |
| `<properties><property name value>` | ✓ | ✓ | ✓ |
| `<stresses>` | ✓ (passthrough) | ✓ | ✓ |
| `<tags><tag value>` | ✓ | ✓ | ✓ |
| Unknown attributes on `<problem>` and `<judging>` | ✓ (`_extraAttrs`) | ✓ | ✓ |
| Unknown top-level child elements | ✓ (`_unknownNodes`) | ✓ | ✓ |

### Package Types

| Type | Test files on disk | .exe/.bat files | Scripts |
|---|---|---|---|
| `standard` | No (generated on demand) | Yes | Placeholder |
| `linux` | Yes | No | `.sh` scripts |
| `windows` | Yes | Yes | `.bat` scripts |

### Files Included in Built Packages

- `problem.xml`
- All `files/` resources and executables (filtered by type for linux/windows)
- All `solutions/` source files
- `statements/` assets per language
- `tests/` input and answer files (linux and windows only; standard omits test data)
- `scripts/` directory with placeholder build scripts

---

## Fixtures Tested

| Package | Tests parsed | Groups | Interactor | Validator tests | Solutions |
|---|---|---|---|---|---|
| `rombuses-59.zip` (standard) | 22 | No | No | 7 | 16 |
| `rombuses-59$linux.zip` | 22 | No | No | 7 | 16 |
| `zaoch-2012-2-7-43.zip` | 49 | 5 (with deps) | No | — | — |
| `joisc-2018-3-1-6.zip` | — | No | Yes (runs: [1,2]) | — | — |

All four packages import without errors. Round-trip (import → export → import) preserves all structured fields.

---

## Known Differences from Polygon

| Area | Polygon | Lite Polygon |
|---|---|---|
| Statement rendering | Full LaTeX PDF via pdflatex | Plain-text section editing; no PDF generation |
| Statement viewer | Rendered HTML with MathJax | Plain text preview |
| Checker name lookup | Resolves `std::wcmp.cpp` etc. from testlib distribution | Stored as given; no testlib bundled |
| Windows `.exe` binaries | Compiled on Windows | Not compiled; stored from package as-is |
| Invocation parallelism | Parallel across servers | Parallel within one process (`INVOCATION_WORKERS`, default 4) |
| Stress testing | Fully automated compare loop | UI for managing stress configurations; loop not yet automated |
| Review/messages | Collaborative review workflow | Not implemented |
| Problem sharing | Configurable roles | Not implemented (single owner) |
| AI tips | Available on Polygon | Explicitly disabled; always returns `[]` |
| MathJax in statements | Live preview | Not rendered in the app |
| Tags suggestions | AI-assisted | Not implemented |
| Problem search | Full-text search | Not implemented |

---

## Source Type Mapping

Polygon packages from Windows use `cpp.gcc14-64-msys2-g++23` as the source type. Lite Polygon maps this to `g++ -std=c++23 -O2` for local compilation. The string is preserved verbatim in exported `problem.xml`.

---

## Not Implemented (no specification available)

- The exact format of Polygon's `scripts/` build scripts beyond placeholders
- The exact semantics of `problem.xml` `stages` and `assets` attributes on `<file>`
- The `treat-points-from-checker-as-percent` scoring mode in invocations
- The `latex-pdf-mode` attribute on `<statements>`
