# Shortlink

API NestJS para encurtamento de URLs multitenant. Este README cobre a operação local via Docker Compose, incluindo autenticação com HTTPS, worker de e-mail, migrations e testes.

## Pré-requisitos

- Docker e Docker Compose
- Arquivo `.env` baseado em `.env.example` (copie e ajuste os placeholders)

```bash
cp .env.example .env
```

Todos os comandos `npm` executam **dentro** do serviço `api`. Não rode `npm` no host.

## Subir a stack

```bash
docker compose up --detach
```

Serviços principais:

| Serviço | Função |
| --- | --- |
| `api` | API NestJS (porta interna `3000`, sem publicação direta no host) |
| `nginx` | Proxy TLS: HTTP → HTTPS e HTTPS → API |
| `postgres` | Fonte de verdade |
| `redis` | Cache, limites, códigos e fila BullMQ |
| `mailpit` | SMTP local e UI de e-mails |
| `queue-worker` | Consome jobs de e-mail (mesma imagem da API) |
| `tls-init` | Gera CA e certificado locais em volume (executa uma vez) |

Verifique o estado:

```bash
docker compose ps
```

Se o Nginx retornar `502`, reinicie-o após a API ficar saudável:

```bash
docker compose restart nginx
```

## HTTPS local

O cookie de refresh exige `Secure`; por isso o ambiente local expõe HTTPS.

| Porta no host | Protocolo | Destino |
| --- | --- | --- |
| `API_HOST_PORT` (padrão `3000`) | HTTP | Redireciona para HTTPS |
| `TLS_HOST_PORT` (padrão `8443`) | HTTPS | Proxy para a API |

- Origem típica: `https://localhost:8443`
- A CA e o certificado ficam no volume `shortlink_tls_certs` (`/certs` nos containers `api` e `nginx`).
- Chaves privadas **não** são versionadas no repositório.

### Confiança na CA nos testes E2E

Os testes E2E HTTPS confiam na CA local em `/certs/ca.crt` (montada no serviço `api`). A validação TLS **não** é desabilitada. Opcionalmente, defina `TLS_CA_PATH` se o caminho da CA for diferente.

## Queue worker

O serviço `queue-worker` processa e-mails de ativação, login e redefinição via BullMQ + Mailpit.

- Comando: `npm run start:worker` (desenvolvimento) / `npm run start:worker:prod` (produção)
- Não publica porta no host
- Depende de PostgreSQL, Redis e Mailpit saudáveis
- UI do Mailpit: `http://localhost:${MAILPIT_UI_PORT:-8025}`

## Variáveis de ambiente

Consulte `.env.example` para a lista completa e placeholders. Categorias principais:

- **App / HTTP**: `NODE_ENV`, `PORT`, `CORS_ALLOWED_ORIGINS`, `TRUST_PROXY`, `FRONTEND_RESET_URL`
- **Autenticação**: `JWT_ACCESS_SECRET`, `AUTH_HMAC_SECRET`, `AUTH_TOKEN_HASH_SECRET`, `REFRESH_COOKIE_NAME`
- **PostgreSQL**: `POSTGRES_*`
- **Redis**: `REDIS_HOST`, `REDIS_PORT`
- **E-mail / fila**: `MAILPIT_*`, `MAIL_FROM`, `EMAIL_QUEUE_ATTEMPTS`, `EMAIL_QUEUE_BACKOFF_MS`
- **Portas Compose**: `API_HOST_PORT`, `API_CONTAINER_PORT`, `TLS_HOST_PORT`, `MAILPIT_UI_PORT`

Segredos em desenvolvimento são placeholders (`change-me-*-dev-only`). Não use valores reais no exemplo versionado.

## Migrations (TypeORM)

`synchronize` permanece desabilitado. Migrations são geradas pelo CLI a partir das entidades — não escreva SQL manualmente.

```bash
# Gerar migration a partir das entidades (passe o caminho/nome do arquivo)
docker compose exec api npm run migration:generate -- src/migrations/NomeDaMigration

# Aplicar pending
docker compose exec api npm run migration:run

# Reverter a última
docker compose exec api npm run migration:revert
```

## Testes

Matriz detalhada: `.specs/codebase/TESTING.md`.

Antes de integração ou E2E, a stack deve estar no ar (`docker compose up --detach`), incluindo `queue-worker` para fluxos que dependem de e-mail.

```bash
# Unitários
docker compose exec api npm run test -- --runInBand

# Integração (PostgreSQL, Redis, filas)
docker compose exec api npm run test:integration -- --runInBand

# E2E (HTTPS, cookies, Mailpit)
docker compose exec api npm run test:e2e -- --runInBand

# Qualidade
docker compose exec api npm run lint
docker compose exec api npm run build
```

### Gate completo

```bash
docker compose exec api npm run lint && \
docker compose exec api npm run build && \
docker compose exec api npm run test -- --runInBand && \
docker compose exec api npm run test:integration -- --runInBand && \
docker compose exec api npm run test:e2e -- --runInBand
```

## Documentação da feature de autenticação

- Spec: `.specs/features/authentication/spec.md`
- Design: `.specs/features/authentication/design.md`
- Tasks: `.specs/features/authentication/tasks.md`
