# Shortlink - Agent Instructions

## Project Overview

Shortlink is an **AI First** URL shortener built with **NestJS**, **TypeORM**, **PostgreSQL**, **Redis**, **JWT**, and **Docker**.

The system must be modular, secure, testable, and easy for AI agents to understand and evolve.

Do not overengineer. Prefer simple, explicit, maintainable solutions.

---

## Core Stack

- Backend API: NestJS
- Database: PostgreSQL
- ORM: TypeORM
- Cache: Redis
- Authentication: JWT
- Short code generation: Node.js `crypto`
- Infrastructure: Docker / Docker Compose
- Tests: Mandatory
- Architecture: Modular monolith

---

## Main Rules

- Always inspect existing project files before implementing changes.
- Prefer existing scripts from `package.json`.
- Do not assume commands, folder structure, or libraries that are not present.
- Keep controllers thin.
- Keep business rules inside services or domain-specific classes.
- Keep persistence logic inside repositories.
- Keep modules independent and explicit.
- Never bypass authentication, authorization, validation, or tests.
- Never expose internal database IDs as public short codes.
- Never treat Redis as the source of truth.
- Never create TypeORM migrations manually.
- Always execute project commands inside the `api` Docker Compose service. Do not run `npm` commands on the host.

---

## Arquitetura e organização de código

- Organize o sistema como monólito modular por bounded contexts do DDD; cada contexto contém seu domínio, casos de uso, interfaces e implementações concretas.
- Prefira a estrutura de arquivos mais flat possível dentro de cada contexto. Não crie diretórios apenas para espelhar camadas; introduza-os somente quando houver outro bounded context ou a quantidade de arquivos prejudicar a navegação.
- Aplique arquitetura hexagonal por dependências: controllers, guards e consumers recebem entradas; banco, Redis, filas, SMTP e integrações externas são implementações externas.
- Casos de uso e domínio dependem de interfaces definidas pelo próprio contexto, nunca de TypeORM, Redis, BullMQ, HTTP ou SMTP diretamente.
- Use interfaces pequenas, orientadas a uma capacidade do domínio, e conecte implementações concretas somente no módulo NestJS.
- Não use `port` ou `adapter` nos nomes de arquivos ou classes. Use nomes do papel que exercem, como `auth.repository.ts`, `typeorm-auth.repository.ts`, `auth-email.service.ts` e `queue-auth-email.service.ts`.
- Use Value Objects imutáveis para valores com invariantes de domínio, como `Email`, `Password` e `PasswordHash`; evite primitive obsession.
- Preserve SOLID: uma responsabilidade por classe, controllers finos, inversão de dependência nas fronteiras e abstrações somente quando houver dependência variável ou regra de domínio.
- Aplique Object Calisthenics pragmaticamente: mantenha métodos em um nível de abstração, use retornos antecipados para reduzir aninhamento e dê nomes que expressem intenção. Não crie wrappers ou classes sem valor de domínio comprovado.
- Não permita que entidades de persistência, DTOs HTTP ou tipos de bibliotecas externas vazem para o domínio ou através de interfaces.

---

## Context7 MCP

Always use Context7 when code generation, setup, configuration, or library/API documentation is needed.

Use Context7 especially for:

- NestJS
- TypeORM
- PostgreSQL
- Redis
- JWT
- Testing libraries
- Docker configuration

Resolve the library ID first, then fetch the relevant docs.

---

## Infrastructure

PostgreSQL and Redis run through Docker.

Before starting the application or running integration/e2e tests, make sure containers are running.

Expected command:

```bash
docker compose up --detach
```

In cloud environments, Docker daemon may need to be started first:

```bash
dockerd &>/var/log/dockerd.log &
```

Then wait a few seconds before running Docker Compose.

---

## Running the Application

Use the scripts defined in `package.json`, executed inside the `api` Docker Compose service.

Common commands may include:

```bash
docker compose exec api npm run start:dev
docker compose exec api npm run build
docker compose exec api npm run lint
docker compose exec api npm run test
docker compose exec api npm run test:e2e
```

Do not run `npm` commands directly on the host. Use the package manager already used by the project from within the `api` container.

Before running the app:

1. Check `package.json`.
2. Check `.env.example`.
3. Start PostgreSQL and Redis.
4. Run pending migrations if needed.
