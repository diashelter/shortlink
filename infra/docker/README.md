# Local Docker Stack

This project runs locally through Docker Compose. The host needs Docker and Docker Compose; Node.js, PostgreSQL, Redis and Mailpit do not need to be installed directly on the host for normal stack usage.

## Setup

Create a local environment file from the example:

```bash
cp .env.example .env
```

`.env` is ignored by Git. Keep real secrets out of versioned files.

## Services

| Service | Responsibility | Host access |
| --- | --- | --- |
| `api` | NestJS API in development watch mode | `http://localhost:3000/` |
| `postgres` | PostgreSQL database | Internal Docker network only |
| `redis` | Redis cache and supporting infrastructure | Internal Docker network only |
| `mailpit` | Development email capture | UI at `http://localhost:8025/` |

Mailpit SMTP listens on port `1025` inside the Docker network and is not published to the host. PostgreSQL and Redis are also internal-only by default.

## Stack Commands

Validate the Compose file:

```bash
rtk docker compose config
```

Build the API image:

```bash
rtk docker compose build
```

Start the stack:

```bash
rtk docker compose up --detach
```

Inspect services:

```bash
rtk docker compose ps
```

Stop the stack:

```bash
rtk docker compose down
```

Stop the stack and remove persisted database/cache volumes:

```bash
rtk docker compose down --volumes
```

## Project Commands

Run npm commands inside the `api` container:

```bash
rtk docker compose exec api npm run build
rtk docker compose exec api npm run lint
rtk docker compose exec api npm run test
rtk docker compose exec api npm run test:e2e
```

The API container runs `npm run start:dev` by default and bind mounts the project source for hot reload. `/app/node_modules` is kept as a container volume so host dependencies do not conflict with container dependencies.
