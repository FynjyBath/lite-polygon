# Lite Polygon

A self-hosted, locally-run clone of [Codeforces Polygon](https://polygon.codeforces.com) for competitive programming problem preparation. Supports the full Polygon package format (standard, linux, windows) with round-trip import/export fidelity.

---

## Features

- **Polygon-compatible UI** — tabs, compact tables, and workflow identical to Polygon
- **Full problem lifecycle** — General Info → Statements → Tests → Solutions → Packages
- **Polygon package import/export** — standard/linux/windows variants, full XML round-trip
- **C++ judging** — compile with g++17/g++20/g++23, run with time/memory limits, testlib checker
- **Polygon-compatible REST API** at `/api/{methodName}` with apiSig authentication
- **Per-user problem isolation** — each user sees only their own problems
- **No cloud dependency** — everything runs locally on your machine

---

## Quick Start

### Prerequisites

- Node.js 18+
- g++ (C++17 support required; g++20/23 optional)
- npm
- A LaTeX toolchain for compiling statement PDFs (`pdflatex` + Cyrillic/T2A
  support). On Debian/Ubuntu:

  ```bash
  sudo apt-get install --no-install-recommends \
    texlive-latex-base texlive-latex-recommended texlive-latex-extra \
    texlive-lang-cyrillic texlive-fonts-recommended texlive-science \
    texlive-plain-generic
  ```

  Statements are rendered with the bundled Polygon templates in
  `backend/templates/statements/` (FreeMarker → LaTeX → PDF). If `pdflatex`
  is missing, statement-PDF compilation reports an error but the rest of the
  app keeps working.

### Install

```bash
git clone <repo-url>
cd lite-polygon

cd backend && npm install
cd ../frontend && npm install
```

### Build frontend

```bash
cd frontend
npm run build
```

### Start the server

```bash
cd backend
npm run dev        # Development (tsx watch)
# or
npm run build && npm start   # Production
```

The server listens on `http://localhost:5000` by default.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `../data` | Directory for SQLite DB, problem files, packages |
| `FRONTEND_DIST` | `../frontend/dist` | Path to built frontend |
| `INVOCATION_WORKERS` | `4` | Parallel test runs per invocation. Set to `nproc - 2` for best results (e.g. `6` on an 8-core machine). Higher values speed up large invocations but reduce per-test timing accuracy. |

Example:

```bash
DATA_DIR=/srv/lite-polygon-data PORT=8080 INVOCATION_WORKERS=6 npm start
```

To change `INVOCATION_WORKERS` on a systemd deployment, edit `/etc/systemd/system/lite-polygon.service`:

```ini
Environment=INVOCATION_WORKERS=4
```

Then reload and restart:

```bash
systemctl daemon-reload && systemctl restart lite-polygon
```

---

## First Login

On first startup, an **admin** account is created automatically:

| Username | Password |
|---|---|
| `admin` | `admin` |

You will be prompted to change the password on first login. To create additional users, go to `/register`.

---

## Creating a Problem

1. Log in at `http://localhost:5000`
2. Click **New Problem** and enter a short name (e.g. `a-plus-b`)
3. Fill in the tabs: **General Info** → **Statement** → **Tests** → **Checker** → **Solutions**
4. Build a package from the **Packages** tab

Or via API:

```bash
# Login
curl -c cookies.txt -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}'

# Create problem
curl -b cookies.txt -X POST http://localhost:5000/api/problem.create \
  -H 'Content-Type: application/json' \
  -d '{"name":"a-plus-b"}'
```

---

## Importing a Polygon Package

From the UI: **Problems list** → **Import Package** → upload a `.zip` file.

From the API:

```bash
curl -b cookies.txt -X POST http://localhost:5000/api/problem.importPackage \
  -F "file=@rombuses-59.zip"
```

To overwrite an existing problem with the same short name:

```bash
curl -b cookies.txt -X POST \
  "http://localhost:5000/api/problem.importPackage?overwrite=true" \
  -F "file=@rombuses-59\$linux.zip"
```

Supported package types: **standard**, **linux**, **windows** (all Polygon export variants).

---

## Building Packages

From the UI: **Packages** tab → select type → **Build**. The build is async; a download link appears when ready.

From the API:

```bash
# Start build
curl -b cookies.txt -X POST http://localhost:5000/api/problem.buildPackage \
  -H 'Content-Type: application/json' \
  -d '{"problemId":1,"type":"linux"}'

# Poll status
curl -b cookies.txt "http://localhost:5000/api/problem.packages?problemId=1"

# Download
curl -b cookies.txt -o problem.zip \
  "http://localhost:5000/api/problem.package?problemId=1&packageId=5"
```

---

## API Key Authentication

API key auth lets you call the API without a session cookie, using the Polygon-compatible `apiSig` scheme.

### Generate an API key

```bash
curl -b cookies.txt -X POST http://localhost:5000/api/auth/generateApiKey
# Returns: { "result": { "apiKey": "abc123", "apiSecret": "xyz789" } }
```

### Sign a request

```
rand   = random 6 hex chars
params = all params (including apiKey and time) sorted by key then value
sig    = SHA-512("${rand}/${methodName}?${sorted_query_string}#${apiSecret}")
apiSig = rand + sig
```

`time` must be within ±300 seconds of server time.

Node.js example:

```javascript
const crypto = require('crypto');

function sign(methodName, params, apiKey, apiSecret) {
  const time = String(Math.floor(Date.now() / 1000));
  const allParams = { ...params, apiKey, time };
  const sorted = Object.entries(allParams)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const rand = crypto.randomBytes(3).toString('hex');
  const hash = crypto.createHash('sha512')
    .update(`${rand}/${methodName}?${sorted}#${apiSecret}`)
    .digest('hex');
  return { ...allParams, apiSig: rand + hash };
}
```

---

## Supported Source Types

| Source type | Compiler flags |
|---|---|
| `cpp.g++17` | `g++ -std=c++17 -O2` |
| `cpp.g++20` | `g++ -std=c++20 -O2` |
| `cpp.gcc14-64-msys2-g++23` | `g++ -std=c++23 -O2` |

Unknown source types are stored as-is and preserved in XML round-trips but cannot be compiled locally.

---

## Judging

**Invocations**: run selected solutions against all tests. The **Invocations** tab shows a solution × test verdict matrix.

Verdicts: `OK`, `WA`, `TL`, `ML`, `RE`, `CE`, `CRASHED`.

- Checker exit 0 = OK, 1 = WA, 2 = PE, 3 = Partial
- Validator exit 0 = valid, non-zero = invalid

---

## Data Location

```
data/
  db.sqlite3
  problems/
    <id>/
      tests/            # Input/answer files
      solutions/        # Source files
      files/            # Resources (checker, validator…)
      statements/       # Statement assets
      statement-sections/
      workdir/          # Compiled binaries
  packages/             # Built ZIP archives
```

### Backup

```bash
cp -r /path/to/data /path/to/backup
```

---

## Running Tests

```bash
cd backend
npx vitest run
```

| Test file | Coverage |
|---|---|
| `apiSig.test.ts` | Signature generation/verification |
| `polygonXml.test.ts` | XML parser/generator round-trip |
| `import.test.ts` | Package import (skips if fixture ZIPs missing) |
| `api.test.ts` | REST API endpoints: auth, CRUD, access control |

Fixture ZIPs (`rombuses-59.zip`, `zaoch-2012-2-7-43.zip`, `joisc-2018-3-1-6.zip`, `rombuses-59$linux.zip`) must be in the repo root to run import tests.

---

## Security Model

- Passwords and API secrets are bcrypt-hashed (cost 10)
- Sessions stored in SQLite with 30-day expiry
- ZIP extraction rejects absolute paths, `..` traversal, files >200 MB, archives >10,000 files
- Problem ownership enforced at every API endpoint
- Intended for local/intranet use; add a TLS reverse proxy for public exposure

---

## Architecture

```
backend/src/
  db/schema.ts          SQLite schema, lazy DB init
  routes/auth.ts        /api/auth/*
  routes/problems.ts    /api/problem.* (50+ endpoints)
  services/auth.ts      User/session CRUD
  services/problems.ts  Problem/test/solution CRUD
  services/import.ts    Polygon package import
  judging/compiler.ts   Compile + run binaries
  judging/judging.ts    Invocations, test generation (parallel via INVOCATION_WORKERS)
  packages/builder.ts   Package ZIP assembly
  polygon-xml/          parser.ts · generator.ts · types.ts
  utils/apiSig.ts       Polygon apiSig sign/verify
  utils/zip.ts          Safe ZIP extract/create

frontend/src/
  pages/Problem/        Per-tab React components
  api/client.ts         API wrappers + TypeScript types
  styles/global.css     Polygon-style CSS
```

Stack: **Fastify** · **better-sqlite3** · **React/Vite** · **TypeScript**
