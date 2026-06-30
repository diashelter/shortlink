# Stack Local Containerizada Tasks

**Spec**: `.specs/features/containerized-local-stack/spec.md`
**Design**: Not created; implementation design is captured in the SPEC and this task breakdown.
**Status**: Done

**Execution result**: T1-T6 completed on 2026-06-29.
**Validation note**: local `.env` uses `MAILPIT_UI_PORT=8026` because host port `8025` was already allocated by an existing external `mailpit` container. Versioned defaults remain documented as `8025`.

---

## Testing And Gate Matrix

No `.specs/codebase/TESTING.md` exists yet. This feature changes Docker/configuration/documentation files and does not create NestJS application layers. Test co-location is therefore handled through Docker Compose gates and existing npm scripts executed inside the `api` container.

| Layer or artifact | Test type | Gate command |
| --- | --- | --- |
| `.dockerignore` | none | `rtk docker compose build` |
| `Dockerfile` | build | `rtk docker compose build` |
| `.env.example` | config | `rtk docker compose config` |
| `docker-compose.yml` | integration | `rtk docker compose config && rtk docker compose up --detach && rtk docker compose ps` |
| `infra/docker/README.md` | none | Manual consistency against SPEC plus final full gate |
| Full stack | integration | `rtk docker compose build && rtk docker compose up --detach && rtk docker compose exec api npm run build && rtk docker compose exec api npm run test` |

---

## Execution Plan

### Phase 1: Foundation (Parallel OK)

Create independent foundation files used by the Docker stack.

```text
T1 [P]
T2 [P]
T3 [P]
```

### Phase 2: Compose Integration (Sequential)

Wire the services together after the foundational files exist.

```text
T1, T2, T3 --> T4
```

### Phase 3: Documentation And Verification (Sequential)

Document the stack and run the final validation gate.

```text
T4 --> T5 --> T6
```

---

## Task Breakdown

### T1: Create Dockerignore [P]

**What**: Create `.dockerignore` to keep the API image build context small and prevent local-only files from entering the image.
**Where**: `.dockerignore`
**Depends on**: None
**Reuses**: Existing `.gitignore` patterns
**Requirement**: INFRA-004, NFR-002, NFR-003

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `.dockerignore` exists at the repository root.
- [ ] It ignores `node_modules`, `dist`, `coverage`, logs and local env files.
- [ ] It does not ignore `package.json`, `package-lock.json`, `src`, `test`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json` or files required by the Docker build.
- [ ] Gate check passes after T2/T4 are available: `rtk docker compose build`.

**Tests**: none
**Gate**: build

**Verify**:

```bash
rtk docker compose build
```

Expected: API image builds without missing required project files.

---

### T2: Create API Dockerfile [P]

**What**: Create root `Dockerfile` for running the NestJS API inside a Node.js 22 slim container.
**Where**: `Dockerfile`
**Depends on**: None
**Reuses**: `package.json`, `package-lock.json`, existing NestJS scripts
**Requirement**: INFRA-002, INFRA-003, NFR-002, NFR-005

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `Dockerfile` uses a fixed Node.js 22 slim image tag and does not use `latest`.
- [ ] It sets a stable workdir, for example `/app`.
- [ ] It copies `package.json` and `package-lock.json` before the rest of the source.
- [ ] It installs dependencies with `npm ci`.
- [ ] It exposes port `3000`.
- [ ] It has a development-compatible default command, with Compose allowed to override it.
- [ ] Gate check passes after T1/T4 are available: `rtk docker compose build`.

**Tests**: build
**Gate**: build

**Verify**:

```bash
rtk docker compose build
```

Expected: API image builds successfully using the pinned slim Node.js image.

---

### T3: Create Environment Example [P]

**What**: Create `.env.example` with local container-first defaults for API, PostgreSQL, Redis and Mailpit.
**Where**: `.env.example`
**Depends on**: None
**Reuses**: Existing `.gitignore` rule for `.env`
**Requirement**: INFRA-001, INFRA-008, NFR-003, NFR-004

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `.env.example` exists at the repository root.
- [ ] It defines API environment and port values, including host port `3000`.
- [ ] It defines PostgreSQL database, user, password and internal host values using `shortlink` defaults.
- [ ] It defines Redis internal host/port values.
- [ ] It defines Mailpit internal SMTP host/port and UI host port values.
- [ ] It contains only development-safe placeholder values and no real secrets.
- [ ] `.env` remains ignored by `.gitignore`.
- [ ] Gate check passes after T4 is available: `rtk docker compose config`.

**Tests**: config
**Gate**: config

**Verify**:

```bash
rtk docker compose config
```

Expected: Compose resolves variables from `.env` or compatible values copied from `.env.example`.

---

### T4: Create Docker Compose Stack

**What**: Create `docker-compose.yml` wiring `api`, `postgres`, `redis` and `mailpit` with internal networking, volumes, healthchecks and service dependencies.
**Where**: `docker-compose.yml`
**Depends on**: T1, T2, T3
**Reuses**: `Dockerfile`, `.dockerignore`, `.env.example`, existing NestJS port `3000`
**Requirement**: INFRA-001, INFRA-002, INFRA-005, INFRA-006, INFRA-007, INFRA-010, NFR-001, NFR-002, NFR-003, NFR-004, NFR-005

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `docker-compose.yml` defines services exactly named `api`, `postgres`, `redis` and `mailpit`.
- [ ] `api` builds from the root `Dockerfile`.
- [ ] `api` runs `npm run start:dev`.
- [ ] `api` publishes host port `3000` to container port `3000`.
- [ ] `api` bind mounts the project source and uses an anonymous volume for `/app/node_modules`.
- [ ] `api` has a healthcheck against HTTP `/`.
- [ ] `api` depends on healthy `postgres`, `redis` and `mailpit` services when supported by Docker Compose.
- [ ] `postgres` uses a fixed official image tag, stores data in a named volume and does not publish `5432` to the host.
- [ ] `redis` uses a fixed official image tag, stores data in a named volume and does not publish `6379` to the host.
- [ ] `mailpit` uses a fixed image tag, exposes only the UI port on the host and keeps SMTP internal.
- [ ] Healthchecks exist for all four services.
- [ ] Gate check passes: `rtk docker compose config`.

**Tests**: integration
**Gate**: config

**Verify**:

```bash
rtk docker compose config
```

Expected: Compose configuration is valid and shows the four required services with no `latest` image tags.

---

### T5: Create Docker Infrastructure Documentation

**What**: Create `infra/docker/README.md` documenting how to use the local containerized stack.
**Where**: `infra/docker/README.md`
**Depends on**: T4
**Reuses**: `.specs/features/containerized-local-stack/spec.md`, `docker-compose.yml`, `.env.example`, existing npm scripts
**Requirement**: INFRA-009, INFRA-011, NFR-001, NFR-005

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Documentation explains how to copy `.env.example` to `.env`.
- [ ] Documentation lists all four services and their responsibilities.
- [ ] Documentation explains that the API runs inside Docker and host Node.js is not required for normal stack operation.
- [ ] Documentation shows how to start, inspect and stop the stack.
- [ ] Documentation lists `docker compose exec api npm run build`.
- [ ] Documentation lists `docker compose exec api npm run lint`.
- [ ] Documentation lists `docker compose exec api npm run test`.
- [ ] Documentation lists `docker compose exec api npm run test:e2e`.
- [ ] Documentation states PostgreSQL, Redis and Mailpit SMTP are internal-only.
- [ ] Documentation states API URL `http://localhost:3000/` and Mailpit UI URL `http://localhost:8025/` by default.
- [ ] Gate check passes after T6: full validation gate.

**Tests**: none
**Gate**: full

**Verify**:

```bash
rtk docker compose ps
```

Expected: Documentation commands match the implemented Compose service names and ports.

---

### T6: Validate Containerized Stack

**What**: Run the final validation commands and fix any SPEC deviations found in the created Docker files or documentation.
**Where**: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, `infra/docker/README.md`
**Depends on**: T5
**Reuses**: Existing npm scripts from `package.json`
**Requirement**: INFRA-001, INFRA-002, INFRA-003, INFRA-004, INFRA-005, INFRA-006, INFRA-007, INFRA-008, INFRA-009, INFRA-010, INFRA-011

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `rtk docker compose config` passes.
- [ ] `rtk docker compose build` passes.
- [ ] `rtk docker compose up --detach` starts `api`, `postgres`, `redis` and `mailpit`.
- [ ] `rtk docker compose ps` shows all four services running and healthy after startup.
- [ ] `rtk docker compose exec api npm run build` passes.
- [ ] `rtk docker compose exec api npm run test` passes.
- [ ] API responds at `http://localhost:3000/`.
- [ ] Mailpit UI responds at `http://localhost:8025/` by default.
- [ ] Any validation fixes remain within the files created by this feature.

**Tests**: integration
**Gate**: full

**Verify**:

```bash
rtk docker compose config
rtk docker compose build
rtk docker compose up --detach
rtk docker compose ps
rtk docker compose exec api npm run build
rtk docker compose exec api npm run test
```

Expected: all commands pass and the stack is usable without installing Node.js, PostgreSQL or Redis on the host.

---

## Parallel Execution Map

```text
Phase 1:
  T1 [P]
  T2 [P]
  T3 [P]

Phase 2:
  T1, T2, T3 complete
          |
          v
         T4

Phase 3:
  T4 --> T5 --> T6
```

---

## Pre-Approval Checks

### Check 1: Task Granularity

| Task | Scope | Status |
| --- | --- | --- |
| T1: Create Dockerignore | One file | OK |
| T2: Create API Dockerfile | One file | OK |
| T3: Create Environment Example | One file | OK |
| T4: Create Docker Compose Stack | One file, integrated service wiring | OK |
| T5: Create Docker Infrastructure Documentation | One file | OK |
| T6: Validate Containerized Stack | Verification pass, may fix only feature files | OK |

### Check 2: Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | No incoming arrows | Match |
| T2 | None | No incoming arrows | Match |
| T3 | None | No incoming arrows | Match |
| T4 | T1, T2, T3 | T1, T2, T3 --> T4 | Match |
| T5 | T4 | T4 --> T5 | Match |
| T6 | T5 | T5 --> T6 | Match |

### Check 3: Test Co-Location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1: Create Dockerignore | Docker build context config | none | none | OK |
| T2: Create API Dockerfile | Docker image build config | build | build | OK |
| T3: Create Environment Example | Environment config | config | config | OK |
| T4: Create Docker Compose Stack | Docker Compose integration config | integration | integration | OK |
| T5: Create Docker Infrastructure Documentation | Documentation | none | none | OK |
| T6: Validate Containerized Stack | Stack verification | integration | integration | OK |

---

## Tooling Question Before Execute

Before execution, confirm which tools should be used per task.

Available skills in this workspace:

- `tlc-spec-driven`
- `codenavi`
- `nestjs-modular-monolith`
- `customize-opencode`

Suggested execution tooling:

- T1-T6: use `tlc-spec-driven` for traceability.
- T1-T6: no MCP required based on currently available tools.
- T6: use Docker Compose commands with `rtk` prefix for validation.
