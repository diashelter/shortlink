# Tasks: Estatísticas de Acesso dos Links

**Design:** `.specs/features/link-statistics/design.md`  
**SPEC:** `.specs/features/link-statistics/spec.md`  
**Status:** ✅ Executado e validado — gate completo aprovado em 14 de julho de 2026

## Plano de execução

Todos os testes do projeto executam `--runInBand`; portanto, nenhuma tarefa está marcada como paralela.

```text
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10
```

| Fase | Tarefas | Resultado |
| --- | --- | --- |
| Fundação | T1–T3 | Configuração, dependências, modelo persistente e primitivas puras. |
| Processamento | T4–T6 | Repositório transacional, fila, worker e retenção diária. |
| Integração HTTP | T7–T9 | Resolução enriquecida, coleta não bloqueante e relatório autenticado. |
| Validação | T10 | Gate completo e rastreabilidade atualizada. |

## Task Breakdown

### T1: Configurar runtime de estatísticas

**What:** Adicionar dependências, variáveis validadas e configuração Docker para MMDB local, fila e segredo de pseudonimização.  
**Where:** `package.json`, `environment.validation.ts`, `.env.example`, `docker-compose.yml` e testes de ambiente.  
**Depends on:** None  
**Reuses:** `emailQueue` em `environment.validation.ts`; configuração de serviços Compose existente.  
**Requirements:** LINK-STATS-004, LINK-STATS-009, NFR-LINK-STATS-003, NFR-LINK-STATS-006  
**Tools:** MCP: NONE (Context7 indisponível); Skill: codenavi

**Done when:**
- [x] `@maxmind/geoip2-node` e `@nestjs/schedule` estão declarados pelo gerenciador do projeto.
- [x] Segredo, fila e caminho MMDB seguem a validação de ambiente; MMDB ausente resulta em fallback previsto, não em transferência externa de IP.
- [x] `api` e `queue-worker` recebem configuração idêntica necessária.
- [x] Testes de validação cobrem valores válidos, inválidos e opcionais.

**Status:** ✅ Complete

**Tests:** unit  
**Gate:** `docker compose exec api npm run test -- --runInBand`  
**Expected tests:** pelo menos 4 novos casos de ambiente, sem redução da suíte existente.  
**Commit:** `build: configure link statistics runtime`

### T2: Criar persistência e migration gerada

**What:** Criar entidades e gerar a migration das tabelas de eventos, agregados, visitantes efêmeros e dias finalizados.  
**Where:** `src/modules/link-statistics/*.entity.ts`, `src/migrations/`.  
**Depends on:** T1  
**Reuses:** `LinkEntity`, convenções TypeORM e CLI `migration:generate`.  
**Requirements:** LINK-STATS-005, LINK-STATS-006, NFR-LINK-STATS-004  
**Tools:** MCP: NONE; Skill: codenavi

**Done when:**
- [x] Constraints de `eventId`, agregados por dia/país, visitante diário e dia finalizado existem.
- [x] FKs para `links` usam a política de deleção definida no design.
- [x] A migration é produzida pelo CLI TypeORM, não escrita manualmente.
- [x] O schema permite `Unknown` e não contém coluna para IP ou user-agent.

**Status:** ✅ Complete

**Tests:** integration  
**Gate:** `docker compose exec api npm run test:integration -- --runInBand`  
**Expected tests:** pelo menos 6 novos casos de schema/constraints, sem redução da suíte existente.  
**Commit:** `feat(link-stats): add persistent aggregates schema`

### T3: Implementar derivação segura do acesso

**What:** Implementar detector de tráfego automatizado, pseudonimizador diário e resolver de país local com fallback.  
**Where:** `src/modules/link-statistics/automated-traffic-detector.service.ts`, `visitor-pseudonymizer.service.ts`, `country-resolver.service.ts`, `local-country-resolver.service.ts` e specs co-localizados.  
**Depends on:** T1  
**Reuses:** padrão HMAC de `AuthCryptoService` e `request.ip` com trust proxy.  
**Requirements:** LINK-STATS-003, LINK-STATS-004, NFR-LINK-STATS-003  
**Tools:** MCP: NONE; Skill: codenavi

**Done when:**
- [x] Assinaturas automatizadas conhecidas são excluídas por regra explícita.
- [x] User-agent ausente permanece elegível para coleta.
- [x] Pseudônimo muda entre Links e dias UTC e não expõe seus insumos.
- [x] Resolver nunca chama rede e retorna `Unknown` para erro, IP privado, inválido ou sem match.
- [x] Testes não registram IP/user-agent em mensagens de falha.

**Status:** ✅ Complete

**Tests:** unit  
**Gate:** `docker compose exec api npm run test -- --runInBand`  
**Expected tests:** pelo menos 10 novos casos unitários, sem redução da suíte existente.  
**Commit:** `feat(link-stats): derive anonymized access data`

### T4: Implementar repositório transacional de agregação

**What:** Criar o contrato e a implementação TypeORM para registrar evento, atualizar agregados e fechar dias.  
**Where:** `link-statistics.repository.ts`, `typeorm-link-statistics.repository.ts`, tipos e testes de integração.  
**Depends on:** T2, T3  
**Reuses:** `TypeormLinksRepository` para transações, outcomes e tratamento de constraint.  
**Requirements:** LINK-STATS-005, LINK-STATS-006, NFR-LINK-STATS-004  
**Tools:** MCP: NONE; Skill: codenavi

**Done when:**
- [x] Evento duplicado não incrementa nenhum agregado.
- [x] Dois acessos do mesmo pseudônimo/dia contam dois acessos e um único.
- [x] Dia finalizado descarta job tardio.
- [x] Finalização remove somente eventos e visitantes efêmeros do dia fechado.

**Status:** ✅ Complete

**Tests:** integration  
**Gate:** `docker compose exec api npm run test:integration -- --runInBand`  
**Expected tests:** pelo menos 10 novos casos de transação/idempotência, sem redução da suíte existente.  
**Commit:** `feat(link-stats): persist idempotent access aggregates`

### T5: Criar coleta via fila sanitizada

**What:** Registrar a fila BullMQ de estatísticas e implementar o collector abstrato/concreto com payload derivado.  
**Where:** `redis.module.ts`, `link-access-collector.service.ts`, `queue-link-access-collector.service.ts`, tipos de job e testes de integração.  
**Depends on:** T1, T3  
**Reuses:** `AuthEmailService`, `QueueAuthEmailService`, `AUTH_EMAIL_QUEUE`.  
**Requirements:** LINK-STATS-001, LINK-STATS-002, LINK-STATS-004, LINK-STATS-009  
**Tools:** MCP: NONE; Skill: codenavi

**Done when:**
- [x] A fila e job `record-link-access` usam tentativas/backoff específicos.
- [x] O payload contém somente `eventId`, Link, instante UTC, data UTC, país e pseudônimo.
- [x] `jobId` é seguro e não contém `:`, IP, user-agent ou URL de Destino.
- [x] Falha de enqueue é propagável ao chamador para registro sanitizado, sem contrato HTTP.

**Tests:** integration  
**Gate:** `docker compose exec api npm run test:integration -- --runInBand`  
**Expected tests:** pelo menos 4 novos casos de payload/fila, sem redução da suíte existente.  
**Commit:** `feat(link-stats): enqueue sanitized access events`

**Status:** ✅ Complete

### T6: Processar e finalizar estatísticas no worker

**What:** Conectar processor BullMQ e agendador diário exclusivamente ao `queue-worker`.  
**Where:** `link-statistics.processor.ts`, `link-statistics-finalizer.service.ts`, `link-statistics.module.ts`, `worker.module.ts` e testes de integração.  
**Depends on:** T4, T5  
**Reuses:** `EmailProcessor`, `WorkerModule`, `worker.ts` e `@nestjs/schedule`.  
**Requirements:** LINK-STATS-001, LINK-STATS-005, LINK-STATS-006, NFR-LINK-STATS-004  
**Tools:** MCP: NONE; Skill: codenavi

**Done when:**
- [x] O processor chama somente o repositório/serviço de estatísticas e trata job desconhecido com log sanitizado.
- [x] O cron de fechamento às 01:00 UTC não é registrado no processo da API.
- [x] Uma execução repetida do finalizador é idempotente.
- [x] O fluxo assíncrono é verificável por polling com deadline, nunca `sleep` arbitrário.

**Status:** ✅ Complete

**Tests:** integration
**Gate:** `docker compose exec api npm run test:integration -- --runInBand`
**Expected tests:** pelo menos 5 novos casos worker/finalização, sem redução da suíte existente.
**Commit:** `feat(link-stats): process and finalize analytics events`

### T7: Enriquecer resolução com identidade do Link

**What:** Alterar o contrato de resolução e o cache Redis versionado para devolver `linkId` e destino.  
**Where:** `links.types.ts`, `links.service.ts`, `link-resolution-cache.service.ts`, `redis-link-resolution-cache.service.ts` e testes de Links.  
**Depends on:** T5  
**Reuses:** cache-aside e comportamento de fallback atuais.  
**Requirements:** LINK-STATS-002, LINK-STATS-010, NFR-LINK-STATS-001  
**Tools:** MCP: NONE; Skill: codenavi

**Done when:**
- [x] Cache hit e miss retornam o mesmo `ResolvedLink`.
- [x] A chave v2 não interpreta entradas de cache da versão anterior.
- [x] O `302`, `404` e fallback PostgreSQL de Links permanecem inalterados.

**Tests:** unit + integration  
**Gate:** `docker compose exec api npm run test -- --runInBand && docker compose exec api npm run test:integration -- --runInBand`  
**Expected tests:** pelo menos 5 novos casos de resolução/cache, sem redução das suítes existentes.  
**Commit:** `refactor(links): expose resolved link identity`

**Status:** ✅ Complete

### T8: Integrar coleta não bloqueante ao redirecionamento

**What:** Preparar dados temporários e disparar o collector fire-and-forget no middleware público após a resolução elegível.  
**Where:** `register-public-link-resolve.ts`, wiring de módulos e testes E2E.  
**Depends on:** T3, T5, T7  
**Reuses:** middleware Express antecipado e formato manual de `404 LINK_NOT_FOUND`.  
**Requirements:** LINK-STATS-002, LINK-STATS-003, LINK-STATS-004, LINK-STATS-009  
**Tools:** MCP: NONE; Skill: codenavi

**Done when:**
- [x] `302` não aguarda a Promise do collector.
- [x] Bots conhecidos redirecionam sem enfileirar.
- [x] Falha do collector é sanitizada e não muda `302`.
- [x] Código inválido/inexistente/desativado não produz evento.

**Status:** ✅ Complete

**Tests:** e2e  
**Gate:** `docker compose exec api npm run test:e2e -- --runInBand`  
**Expected tests:** pelo menos 5 novos cenários E2E, sem redução da suíte existente.  
**Commit:** `feat(link-stats): collect redirects without blocking`

### T9: Publicar relatório autenticado por Link

**What:** Implementar DTO de período UTC, serviço, controller e consulta do Relatório de Link.  
**Where:** `link-statistics.dto.ts`, `link-statistics.service.ts`, `link-statistics.controller.ts`, módulo e testes E2E.  
**Depends on:** T4, T6  
**Reuses:** `AuthSessionGuard`, `LinkIdParamDto`, `LinksRepository.findById` e erros de Links.  
**Requirements:** LINK-STATS-007, LINK-STATS-008, NFR-LINK-STATS-002  
**Tools:** MCP: NONE; Skill: codenavi

**Done when:**
- [x] `GET /api/v1/links/:linkId/statistics` aplica as 30 datas UTC entre hoje menos 29 dias e hoje, e máximo de 12 meses-calendário inclusivos.
- [x] Resposta contém totais, diário e mensal densos/cronológicos, países ordenados por acessos e `timezone: UTC`.
- [x] Link de outro Usuário retorna `403`; inexistente retorna `404`; desativado preserva histórico.
- [x] Intervalo inválido retorna `422` no envelope existente.

**Status:** ✅ Complete

**Tests:** e2e  
**Gate:** `docker compose exec api npm run test:e2e -- --runInBand`  
**Expected tests:** pelo menos 8 novos cenários E2E, sem redução da suíte existente.  
**Commit:** `feat(link-stats): add private link statistics report`

### T10: Executar gate completo e atualizar rastreabilidade

**What:** Executar todos os gates, registrar evidências e atualizar status/rastreabilidade da feature.  
**Where:** `.specs/features/link-statistics/{spec,design,tasks}.md`, `PROGRESS.md` se a feature estiver completa.  
**Depends on:** T1–T9  
**Reuses:** `.specs/codebase/TESTING.md`.  
**Requirements:** NFR-LINK-STATS-006  
**Tools:** MCP: NONE; Skill: tlc-spec-driven

**Done when:**
- [x] Lint, build, unitários, integração e E2E passam dentro do serviço `api`.
- [x] Nenhum teste é removido, ignorado ou reduzido para aprovar o gate.
- [x] Evidências, contagens reais e desvios aprovados ficam registrados.

**Status:** ✅ Complete

**Evidências do gate completo (14 de julho de 2026):**

| Gate | Resultado |
| --- | --- |
| Lint | Aprovado |
| Build | Aprovado |
| Unitário | 17 suites / **127** testes |
| Integração | 16 suites / **98** testes |
| E2E | 5 suites / **51** testes |

Desvios aprovados: nenhum novo além do SPEC_DEVIATION já documentado em Links (middleware Express para resolução pública). O leitor MaxMind usa `import()` dinâmico porque `@maxmind/geoip2-node` v7 é ESM-only no app CommonJS Nest — leitura permanece local, sem rede.

**Tests:** unit + integration + e2e  
**Gate:** `docker compose exec api npm run lint && docker compose exec api npm run build && docker compose exec api npm run test -- --runInBand && docker compose exec api npm run test:integration -- --runInBand && docker compose exec api npm run test:e2e -- --runInBand`  
**Expected tests:** todas as suítes existentes e os casos novos das tarefas T1–T9.  
**Commit:** `docs(link-stats): record validation evidence`

## Mapa de dependências

```text
T1 → T2 → T4 → T6 → T9 → T10
T1 → T3 → T4
T1 → T3 → T5 → T6
T3 → T5 → T7 → T8 → T10
T3 ───────────────→ T8
```

## Validações pré-execução

### Granularidade

| Tarefa | Entrega coesa | Status |
| --- | --- | --- |
| T1 | Runtime e configuração | ✅ |
| T2 | Modelo persistente e migration | ✅ |
| T3 | Derivação segura de acesso | ✅ |
| T4 | Repositório transacional | ✅ |
| T5 | Coleta por fila | ✅ |
| T6 | Processamento/fechamento no worker | ✅ |
| T7 | Contrato de resolução enriquecida | ✅ |
| T8 | Hook público não bloqueante | ✅ |
| T9 | Endpoint de relatório | ✅ |
| T10 | Gate e evidências | ✅ |

### Diagrama e dependências

| Tarefa | Depends on | Mapa | Status |
| --- | --- | --- | --- |
| T1 | — | origem | ✅ |
| T2 | T1 | T1 → T2 | ✅ |
| T3 | T1 | T1 → T3 | ✅ |
| T4 | T2, T3 | T2/T3 → T4 | ✅ |
| T5 | T1, T3 | T1/T3 → T5 | ✅ |
| T6 | T4, T5 | T4/T5 → T6 | ✅ |
| T7 | T5 | T5 → T7 | ✅ |
| T8 | T3, T5, T7 | T3/T5/T7 → T8 | ✅ |
| T9 | T4, T6 | T4/T6 → T9 | ✅ |
| T10 | T1–T9 | todas → T10 | ✅ |

### Co-localização de testes

| Tarefa | Camada | Testes definidos | Status |
| --- | --- | --- | --- |
| T1, T3, T7 | Serviços/configuração | Unitário | ✅ |
| T2, T4–T6 | TypeORM, fila, worker | Integração | ✅ |
| T8, T9 | HTTP público/autenticado | E2E | ✅ |
| T10 | Gate da feature | Todas as camadas | ✅ |

## Ferramentas de execução

Context7 não está disponível neste workspace. A execução usará os padrões já verificados no repositório, a skill `codenavi` para navegação e as documentações oficiais consultadas para BullMQ, NestJS Schedule e MaxMind.
