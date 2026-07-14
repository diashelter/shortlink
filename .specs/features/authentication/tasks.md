# Tasks: Autenticação com verificação por e-mail

**SPEC**: `.specs/features/authentication/spec.md`  
**Design**: `.specs/features/authentication/design.md`  
**Matriz de testes**: `.specs/codebase/TESTING.md`  
**Status**: Concluída — gate completo aprovado (T22)

## Convenções de execução

- Todos os comandos usam `docker compose exec api`; `npm` não é executado no host.
- Context7 não está disponível neste workspace. Antes de usar API de biblioteca, consultar documentação oficial atual via web.
- Nenhuma tarefa marcada como `[P]`: a matriz exige execução de testes com `--runInBand`, e as tarefas alteram infraestrutura ou o mesmo bounded context `Auth`.
- Cada gate preserva a suíte existente e inclui os testes criados na tarefa; a contagem real é registrada na execução, sem remoção ou `skip` de testes.

## Plano de execução

```text
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11
   → T12 → T13 → T14 → T15 → T16 → T17 → T18 → T19 → T20
   → T21 → T22
```

| Fase | Tarefas | Resultado |
| --- | --- | --- |
| Fundação | T1–T6 | Dependências, testes, bootstrap, Docker/TLS, PostgreSQL, Redis e fila. |
| Domínio e persistência | T7–T13 | Value Objects, entidades, repositórios, estado distribuído e sessões. |
| Fluxos públicos | T14–T20 | Módulo HTTP, cadastro, ativação, login, refresh, logout, reset e proteções. |
| Encerramento | T21–T22 | Documentação operacional e validação completa. |

## Task breakdown

### T1: Configurar dependências e comandos de autenticação

**What**: Adicionar dependências de autenticação, persistência, Redis, fila, e-mail, validação e cookies, além dos scripts de migration e teste de integração.  
**Where**: `package.json`, `package-lock.json`  
**Depends on**: Nenhuma  
**Reuses**: Scripts NestJS e Jest existentes  
**Requirements**: AUTH-001, AUTH-004, AUTH-006, AUTH-008, NFR-AUTH-005  
**Tests**: build  
**Gate**: `docker compose exec api npm run build`

**Done when**:
- [x] Dependências necessárias estão instaladas sem versões inventadas.
- [x] Existem scripts para migration gerada/executada e `test:integration`.
- [x] O script de integração aceita uma suíte ainda vazia durante a fundação, sem mascarar falhas quando testes existirem.
- [x] O build passa sem remover scripts existentes.

**Resultado**: ✅ Complete — commit `76a80eb`. Gate `npm run build` passou.

---

### T2: Configurar harnesses de teste

**What**: Criar as configurações Jest e os comandos das suítes de integração e E2E, sem acoplá-las à infraestrutura ainda não criada.  
**Where**: `test/jest-integration.json`, `test/jest-e2e.json`, `package.json`  
**Depends on**: T1  
**Reuses**: `test/jest-e2e.json`, `.specs/codebase/TESTING.md`  
**Requirements**: NFR-AUTH-004, NFR-AUTH-005  
**Tests**: integration, e2e  
**Gate**: `docker compose exec api npm run test:integration -- --runInBand && docker compose exec api npm run test:e2e -- --runInBand`

**Done when**:
- [x] Cada suíte possui configuração própria, diretório e padrão de nomes explícitos.
- [x] Os comandos de integração e E2E são reconhecidos pelo npm, preservando o script E2E existente.
- [x] Os dois comandos executam suas suítes vazias sem testes skipped; as fixtures com PostgreSQL, Redis, Mailpit e CA local são criadas na tarefa que passa a usá-las.

**Resultado**: ✅ Complete — commit após T2. Gate integration (0 testes) + e2e (1 passed) com `--runInBand`.

---

### T3: Configurar bootstrap HTTP seguro

**What**: Configurar prefixo, validação global, filtro de erro, cookies, CORS, limite de payload e leitura de ambiente.  
**Where**: `src/main.ts`, `src/environment.validation.ts`, `src/api-exception.filter.ts`  
**Depends on**: T2  
**Reuses**: `AppModule`, contrato AUTH-009  
**Requirements**: AUTH-009, NFR-AUTH-002  
**Tests**: unit  
**Gate**: `docker compose exec api npm run test -- --runInBand`

**Done when**:
- [x] Payloads extras retornam `422` no envelope definido.
- [x] Erros conhecidos usam `{ statusCode, code, message, errors? }`.
- [x] CORS requer allowlist configurada e credenciais.
- [x] Testes unitários cobrem filtro e configuração de validação.

**Resultado**: ✅ Complete — commit `7c0e37f`. Gate unitário 4 suites / 13 tests.

---

### T4: Estender Docker para TLS local

**What**: Adicionar Nginx, geração de CA/certificado em volume, redirecionamento HTTP e variáveis de autenticação.  
**Where**: `docker-compose.yml`, `.env.example`, `docker/nginx/`, scripts de inicialização TLS  
**Depends on**: T3  
**Reuses**: Serviços atuais `api`, `postgres`, `redis`, `mailpit`  
**Requirements**: AUTH-009, NFR-AUTH-005  
**Tests**: integration  
**Gate**: `docker compose config && docker compose up --detach && docker compose ps`

**Done when**:
- [x] A API não é publicada diretamente; HTTP público apenas redireciona para HTTPS.
- [x] A CA e certificado são gerados em volume, sem versionar chave privada.
- [x] Compose sobe serviços saudáveis e a origem HTTPS responde.

**Resultado**: ✅ Complete — commit `c5b4bdd`. HTTPS `8443` saudável; HTTP redireciona; API sem porta publicada.

---

### T5: Configurar PostgreSQL, TypeORM e migrations geradas

**What**: Criar DataSource, módulo de banco e comandos para gerar e aplicar migrations TypeORM.  
**Where**: `src/data-source.ts`, `src/database.module.ts`, `src/migrations/`  
**Depends on**: T4  
**Reuses**: Variáveis PostgreSQL existentes  
**Requirements**: AUTH-001, AUTH-002, AUTH-004, AUTH-007, AUTH-010, NFR-AUTH-005  
**Tests**: integration  
**Gate**: `docker compose exec api npm run test:integration -- --runInBand`

**Done when**:
- [x] `synchronize` permanece desabilitado.
- [x] O CLI gera migrations a partir de entidades, sem SQL escrito manualmente.
- [x] A conexão e execução de migrations são verificadas contra PostgreSQL do Compose.

**Resultado**: ✅ Complete — commit `1faea41`. Gate integration 4 passed.

---

### T6: Configurar Redis, BullMQ e SMTP

**What**: Criar módulos compartilhados para cliente Redis, BullMQ e SMTP/Mailpit sem estado local.  
**Where**: `src/redis.module.ts`, `src/redis.service.ts`, `src/mail.module.ts`, `src/smtp-mail.service.ts`  
**Depends on**: T5  
**Reuses**: Redis e Mailpit existentes  
**Requirements**: AUTH-006, AUTH-008, NFR-AUTH-001  
**Tests**: integration  
**Gate**: `docker compose exec api npm run test:integration -- --runInBand`

**Done when**:
- [x] API e worker recebem clientes configurados por ambiente.
- [x] SMTP aponta para Mailpit local e fila usa Redis compartilhado.
- [x] Testes verificam conectividade e não dependem de memória de processo.

**Resultado**: ✅ Complete — commit `bbe8e1d`. Gate integration 2 suites / 7 tests.

---

### T7: Implementar Value Object `Email`

**What**: Criar `Email` imutável para normalização, validação e valor canônico.  
**Where**: `src/modules/auth/email.value-object.ts` e teste co-localizado  
**Depends on**: T6  
**Reuses**: Política de e-mail da SPEC  
**Requirements**: AUTH-002, NFR-AUTH-002  
**Tests**: unit  
**Gate**: `docker compose exec api npm run test -- --runInBand`

**Done when**:
- [x] Remove somente espaços nas extremidades e converte para minúsculas.
- [x] Rejeita formatos inválidos sem expor detalhes internos.
- [x] Testes cobrem normalização, igualdade canônica e entradas inválidas.

**Resultado**: ✅ Complete — commit `b359ab6`. Gate unitário 5 suites / 27 tests.

---

### T8: Implementar `Password`, `PasswordHash` e hashing bcrypt

**What**: Criar Value Objects de senha e a interface/implementação bcrypt de hashing e comparação.  
**Where**: `src/modules/auth/password.value-object.ts`, `password-hash.value-object.ts`, `password-hasher.service.ts`, `bcrypt-password-hasher.service.ts` e testes co-localizados  
**Depends on**: T7  
**Reuses**: Política de senha e custo bcrypt 12 da SPEC  
**Requirements**: AUTH-002, NFR-AUTH-002  
**Tests**: unit  
**Gate**: `docker compose exec api npm run test -- --runInBand`

**Done when**:
- [x] `Password` preserva o valor recebido e aplica a política sem `trim`.
- [x] `PasswordHash` é o único valor persistível.
- [x] Bcrypt usa custo 12 e compara senha sem vazar o valor original.
- [x] Testes cobrem política, imutabilidade, hash e comparação.

**Resultado**: ✅ Complete — commit `7efc111`. Gate unitário 8 suites / 53 tests.

---

### T9: Criar tipos, entidades e migration de autenticação

**What**: Modelar conta, sessão, histórico de refresh, reset e auditoria; gerar a migration correspondente.  
**Where**: `src/modules/auth/*.{entity,enum,types}.ts`, `src/migrations/`  
**Depends on**: T8  
**Reuses**: Modelo de dados do design  
**Requirements**: AUTH-002, AUTH-004, AUTH-007, AUTH-010  
**Tests**: integration  
**Gate**: `docker compose exec api npm run test:integration -- --runInBand`

**Done when**:
- [x] Entidades representam todos os campos, índices e relações do design.
- [x] A migration foi gerada pelo CLI e aplica/reverte no PostgreSQL.
- [x] Testes confirmam unicidade de e-mail e histórico de refresh.

**Resultado**: ✅ Complete — commit `bd6bd6a`. Gate integration 3 suites / 11 tests.

---

### T10: Implementar repositório TypeORM de autenticação

**What**: Definir interface de repositório e implementação TypeORM com transações e lock pessimista da conta.  
**Where**: `src/modules/auth/auth.repository.ts`, `typeorm-auth.repository.ts` e testes co-localizados  
**Depends on**: T9  
**Reuses**: Entidades e DataSource configurados  
**Requirements**: AUTH-001, AUTH-004, AUTH-005, AUTH-007, NFR-AUTH-003  
**Tests**: integration  
**Gate**: `docker compose exec api npm run test:integration -- --runInBand`

**Done when**:
- [x] Casos de uso não importam TypeORM diretamente.
- [x] Transações serializam login, refresh e redefinição concorrentes.
- [x] Testes comprovam que somente a última sessão ativa permanece válida.

**Resultado**: ✅ Complete — commit `33cbf0a`. Gate integration 4 suites / 15 tests.

---

### T11: Implementar auditoria sanitizada

**What**: Definir interface e implementação de auditoria para eventos de sessão, bloqueio e reset.  
**Where**: `src/modules/auth/auth-audit.service.ts`, `typeorm-auth-audit.service.ts` e testes co-localizados  
**Depends on**: T10  
**Reuses**: `AuthAuditEvent`  
**Requirements**: AUTH-010, NFR-AUTH-002  
**Tests**: integration  
**Gate**: `docker compose exec api npm run test:integration -- --runInBand`

**Done when**:
- [x] Eventos relevantes são persistidos com metadados sanitizados.
- [x] Senha, código, refresh token, reset token e e-mail bruto não são persistidos.
- [x] Testes comprovam a ausência desses valores em auditoria.

**Resultado**: ✅ Complete — commit `2b5dc58`. Gate integration 5 suites / 18 tests.

---

### T12: Implementar estado distribuído de autenticação

**What**: Definir interface e implementação Redis para códigos, desafios, `issuanceId`, limites, bloqueios, cooldown e cache de sessão.  
**Where**: `src/modules/auth/auth-state.service.ts`, `redis-auth-state.service.ts` e testes co-localizados  
**Depends on**: T11  
**Reuses**: Prefixos e TTLs do design  
**Requirements**: AUTH-003, AUTH-006, NFR-AUTH-001  
**Tests**: integration  
**Gate**: `docker compose exec api npm run test:integration -- --runInBand`

**Done when**:
- [x] Segredos são armazenados apenas como HMAC/hash e com TTL nativo.
- [x] Consumo único, tentativas e bloqueio são atômicos.
- [x] `issuanceId` impede o processamento de emissão obsoleta.
- [x] Testes verificam TTL, concorrência e falha fechada do Redis.

**Resultado**: ✅ Complete — commit `ec39e83`. Gate integration 6 suites / 28 tests.

---

### T13: Implementar serviços de criptografia, sessão e guard

**What**: Criar geração de segredos, JWT, rotação de refresh, validação de sessão e guard de rotas protegidas.  
**Where**: `src/modules/auth/auth-crypto.service.ts`, `node-auth-crypto.service.ts`, `auth-session.service.ts`, `auth-session.guard.ts` e testes co-localizados  
**Depends on**: T12  
**Reuses**: ADR-0001 e entidade de sessão  
**Requirements**: AUTH-004, AUTH-005, AUTH-006, NFR-AUTH-003  
**Tests**: unit, integration  
**Gate**: `docker compose exec api npm run test -- --runInBand && docker compose exec api npm run test:integration -- --runInBand`

**Done when**:
- [x] JWT contém `sub`, `role`, `sessionId`, `iat` e expiração de 15 minutos.
- [x] Cache ausente ou Redis indisponível consulta PostgreSQL e tenta repopular.
- [x] Reutilização de refresh revoga a sessão.
- [x] Testes cobrem cache, fallback, rotação e revogação imediata.

**Resultado**: ✅ Complete — commit `66236e9`. Gate unitário 74 + integration 33.

---

### T14: Criar módulo HTTP de autenticação

**What**: Criar DTOs, controller, módulo Nest e guard CSRF/origem, incluindo fixtures E2E isoladas e uma rota protegida exclusiva do ambiente de teste.  
**Where**: `src/modules/auth/auth.dto.ts`, `auth.controller.ts`, `auth.module.ts`, `csrf-origin.guard.ts`, app e fixtures E2E  
**Depends on**: T13  
**Reuses**: Contrato AUTH-009 e filtro global  
**Requirements**: AUTH-001, AUTH-009, NFR-AUTH-004  
**Tests**: e2e  
**Gate**: `docker compose exec api npm run test:e2e -- --runInBand`

**Done when**:
- [x] Os nove endpoints e DTOs seguem o prefixo e o contrato publicados.
- [x] Campos extras e payloads inválidos retornam `422`.
- [x] A rota de fixture exige `AuthSessionGuard`.
- [x] O cliente E2E HTTPS confia na CA local sem desabilitar a validação TLS.
- [x] Testes E2E verificam envelope de erro e rejeição de rota sem JWT.

**Resultado**: ✅ Complete — commit `d1994bb`. Gate e2e 2 suites / 6 tests.

---

### T15: Implementar envio assíncrono de e-mail

**What**: Criar serviço de fila, processor e o serviço Compose `queue-worker`, que gera segredo apenas em memória e envia e-mails por Mailpit.  
**Where**: `src/modules/auth/auth-email.service.ts`, `queue-auth-email.service.ts`, `src/email.processor.ts`, `docker-compose.yml` e testes co-localizados  
**Depends on**: T14  
**Reuses**: `issuanceId`, SMTP e BullMQ  
**Requirements**: AUTH-003, AUTH-007, AUTH-008  
**Tests**: integration  
**Gate**: `docker compose exec api npm run test:integration -- --runInBand`

**Done when**:
- [x] Jobs carregam somente IDs, finalidade e `issuanceId`.
- [x] Jobs antigos são descartados e retries não persistem segredo bruto.
- [x] `queue-worker` usa a mesma imagem/configuração da API, não expõe porta e só sobe após Redis e Mailpit saudáveis.
- [x] Mailpit recebe mensagens de ativação, login e reset.
- [x] Testes verificam processamento, retry e emissão obsoleta.

**Resultado**: ✅ Complete — commit `3ad303d`. Gate integration 8 suites / 40 tests.

---

### T16: Implementar cadastro e reenvio de ativação

**What**: Implementar `POST /register` e `POST /resend-email-verification`, incluindo anti-enumeração, limites e cooldown.  
**Where**: `src/modules/auth/auth.service.ts`, `auth.controller.ts` e testes E2E co-localizados  
**Depends on**: T15  
**Reuses**: `Email`, `Password`, repositório, estado Redis e fila  
**Requirements**: AUTH-002, AUTH-003, AUTH-008, AUTH-009  
**Tests**: e2e  
**Gate**: `docker compose exec api npm run test:e2e -- --runInBand`

**Done when**:
- [x] Conta nova nasce `PENDING` e agenda ativação.
- [x] Conta ativa e cooldown retornam `202` genérico sem emitir código.
- [x] Conta pendente preserva senha e respeita limite de envio.
- [x] E2E confirma Mailpit, limite por e-mail/IP e ausência de enumeração.

**Resultado**: ✅ Complete — commit `2963b2c`. Gate e2e 2 suites / 13 tests.

---

### T17: Implementar verificação de e-mail

**What**: Implementar `POST /verify-email` com consumo único e ativação transacional.  
**Where**: `src/modules/auth/auth.service.ts`, `auth.controller.ts` e testes E2E co-localizados  
**Depends on**: T16  
**Reuses**: Código de ativação Redis e repositório  
**Requirements**: AUTH-003, AUTH-009  
**Tests**: e2e  
**Gate**: `docker compose exec api npm run test:e2e -- --runInBand`

**Done when**:
- [x] E-mail canônico e código válido tornam a conta `ACTIVE`.
- [x] O mesmo código não pode ser usado novamente.
- [x] Código inválido, expirado ou usado retorna resposta genérica.
- [x] E2E obtém o código no Mailpit e confirma ativação.

**Resultado**: ✅ Complete — commit `3a3a627`. Gate e2e 2 suites / 16 tests.

---

### T18: Implementar início e conclusão de login

**What**: Implementar `POST /login` e `POST /verify-login`, desafio opaco, sessão única e emissão de tokens.  
**Where**: `src/modules/auth/auth.service.ts`, `auth.controller.ts` e testes E2E co-localizados  
**Depends on**: T17  
**Reuses**: Desafio Redis, sessão, JWT, cookie e auditoria  
**Requirements**: AUTH-003, AUTH-004, AUTH-005, AUTH-008, AUTH-009, AUTH-010  
**Tests**: e2e  
**Gate**: `docker compose exec api npm run test:e2e -- --runInBand`

**Done when**:
- [x] Credencial válida retorna `challengeId`; conta pendente retorna `403 EMAIL_NOT_VERIFIED`.
- [x] Desafio e código válidos retornam access token, CSRF e refresh cookie seguro.
- [x] Novo login revoga a sessão anterior.
- [x] E2E verifica código pelo Mailpit e rota protegida com o JWT.

**Resultado**: ✅ Complete — commit `1e88ce4`. Gate e2e 2 suites / 19 tests.

---

### T19: Implementar refresh e logout

**What**: Implementar `POST /refresh` e `POST /logout` com CSRF, origem, rotação e invalidação imediata.  
**Where**: `src/modules/auth/auth.service.ts`, `auth.controller.ts`, `csrf-origin.guard.ts` e testes E2E co-localizados  
**Depends on**: T18  
**Reuses**: Cookie, `AuthSessionService` e guard  
**Requirements**: AUTH-004, AUTH-005, AUTH-009, NFR-AUTH-003  
**Tests**: e2e  
**Gate**: `docker compose exec api npm run test:e2e -- --runInBand`

**Done when**:
- [x] Refresh válido rotaciona cookie e access token.
- [x] Reuso de refresh revoga a sessão.
- [x] Logout remove cookie, invalida cache e torna JWT existente inválido.
- [x] E2E verifica CSRF/origem e revogação pela rota protegida.

**Resultado**: ✅ Complete — commit `5c64cd3`. Gate e2e 2 suites / 21 tests.

---

### T20: Implementar recuperação e redefinição de senha

**What**: Implementar `POST /forgot-password` e `POST /reset-password`, incluindo link com fragmento e revogação de sessões.  
**Where**: `src/modules/auth/auth.service.ts`, `auth.controller.ts` e testes E2E co-localizados  
**Depends on**: T19  
**Reuses**: Fila, `issuanceId`, `Password`, repositório e sessão  
**Requirements**: AUTH-007, AUTH-008, AUTH-009, AUTH-010  
**Tests**: e2e  
**Gate**: `docker compose exec api npm run test:e2e -- --runInBand`

**Done when**:
- [x] A solicitação responde genericamente para contas existentes, pendentes ou ausentes.
- [x] E-mail contém token opaco somente no fragmento.
- [x] Reset consome token, atualiza senha e revoga todas as sessões.
- [x] E2E confirma que JWT anterior falha após reset.

**Resultado**: ✅ Complete — commit `9486318`. Gate e2e 2 suites / 24 tests.

---

### T21: Validar proteção contra abuso e indisponibilidade

**What**: Cobrir bloqueio por falhas, rate limits, `Retry-After`, Redis indisponível, CORS e ausência de segredos em logs.  
**Where**: Testes de integração/E2E de autenticação e configuração de observabilidade  
**Depends on**: T20  
**Reuses**: Estado Redis, filtro HTTP e auditoria  
**Requirements**: AUTH-006, AUTH-009, AUTH-010, NFR-AUTH-001, NFR-AUTH-002  
**Tests**: integration, e2e  
**Gate**: `docker compose exec api npm run test:integration -- --runInBand && docker compose exec api npm run test:e2e -- --runInBand`

**Done when**:
- [x] Cinco falhas bloqueiam a conta por uma hora e retornam `429`/`Retry-After: 3600`.
- [x] Todos os limites da SPEC retornam `429`.
- [x] Redis indisponível retorna `503` para controles de abuso e preserva fallback PostgreSQL para sessões.
- [x] E2E confirma CORS/CSRF e testes não encontram segredos nos eventos ou logs capturados.

**Resultado**: ✅ Complete — commit `36d7310`. Gate integration 43 + e2e 29.

---

### T22: Documentar e validar a feature completa

**What**: Atualizar documentação de operação e executar a suíte completa sem corrigir escopo fora da feature.  
**Where**: `README.md` ou documentação Docker existente, `.env.example`, `.specs/features/authentication/tasks.md`  
**Depends on**: T21  
**Reuses**: SPEC, design, matriz de testes e comandos existentes  
**Requirements**: AUTH-001–AUTH-010, NFR-AUTH-001–NFR-AUTH-005  
**Tests**: unit, integration, e2e  
**Gate**: Gate completo da matriz de testes

**Done when**:
- [x] Documentação descreve HTTPS local, worker, variáveis de ambiente, migrations e comandos de teste.
- [x] Lint, build, testes unitários, integração e E2E passam.
- [x] Critérios de sucesso da SPEC são marcados somente com evidência dos gates.
- [x] O resultado de cada tarefa é registrado neste arquivo sem apagar histórico.

**Resultado**: ✅ Complete — commit `1da3d88`. Gate completo: lint OK, build OK, unit 11 suites / 75 tests, integration 9 suites / 43 tests, e2e 2 suites / 29 tests (`--runInBand`). Nginx reiniciado antes do E2E quando necessário (502). README e `.env.example` atualizados; critérios da SPEC marcados com evidência do gate.

## Verificação pré-aprovação

### Granularidade

| Grupo | Escopo | Status |
| --- | --- | --- |
| T1–T6 | Uma capacidade de plataforma por tarefa | OK |
| T7–T15 | Um componente de domínio ou infraestrutura por tarefa | OK |
| T16–T20 | Um fluxo HTTP coeso por tarefa | OK |
| T21–T22 | Validação transversal e encerramento | OK |

### Diagrama × dependências

| Tarefa | Dependência declarada | Plano mostra | Status |
| --- | --- | --- | --- |
| T1 | Nenhuma | início | OK |
| T2 | T1 | T1 → T2 | OK |
| T3–T6 | tarefa imediatamente anterior | sequência T2 → T6 | OK |
| T7–T13 | tarefa imediatamente anterior | sequência T6 → T13 | OK |
| T14–T20 | tarefa imediatamente anterior | sequência T13 → T20 | OK |
| T21 | T20 | T20 → T21 | OK |
| T22 | T21 | encerramento | OK |

### Co-localização de testes

| Tarefas | Camada | Matriz exige | Tasks definem | Status |
| --- | --- | --- | --- | --- |
| T1–T6 | Configuração e infraestrutura | build/integração | build/integração | OK |
| T7–T8 | Value Objects e hashing | unitário | unitário | OK |
| T9–T13, T15 | Persistência, Redis, sessão e fila | integração | integração (e unitário quando aplicável) | OK |
| T14, T16–T20 | HTTP e fluxos de usuário | E2E | E2E | OK |
| T21–T22 | Proteção transversal e conclusão | integração/E2E | integração/E2E | OK |

## Ferramentas antes da execução

Antes de executar, confirmar o uso por tarefa:

- **MCP**: Context7 não está disponível; consultar documentação oficial atual quando necessário.
- **Skills**: `tlc-spec-driven` para rastreabilidade e `codenavi` para navegação; usar `nestjs-modular-monolith` somente se surgir uma decisão de limites entre contextos.
