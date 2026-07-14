# Tasks: Core de Links Encurtados

**SPEC:** `.specs/features/links/spec.md`  
**Design:** `.specs/features/links/design.md`  
**Matriz de testes:** `.specs/codebase/TESTING.md`  
**Status:** Em execução

## Convenções de execução

- Todos os comandos executam dentro do serviço `api` do Docker Compose.
- PostgreSQL e Redis devem estar disponíveis antes dos gates de integração e E2E.
- Context7 não está disponível neste workspace. Para APIs de NestJS, TypeORM ou Redis não cobertas por padrões existentes, consultar a documentação oficial atual.
- Nenhuma tarefa é marcada como `[P]`: a matriz exige testes sequenciais com `--runInBand` e as tarefas alteram o mesmo contexto `Links`.
- Cada tarefa inclui os testes da camada que cria; testes não serão adiados para uma tarefa posterior.
- Migrations são geradas pelo CLI TypeORM. Não escrever migration manualmente.

## Plano de execução

```text
T1 → T2 → T3
└──→ T4
T2 → T5 → T6
T3 + T4 + T6 → T7 → T8 → T9 → T10
```

| Fase | Tarefas | Resultado |
| --- | --- | --- |
| Fundação | T1–T4 | Configuração, Value Object, gerador e cache Redis. |
| Persistência | T5–T6 | Entidade, migration e repositório transacional. |
| Casos de uso e HTTP | T7–T9 | Serviço, gestão autenticada e resolução pública. |
| Encerramento | T10 | Documentação e gate completo. |

## Task breakdown

### T1: Adicionar configuração do contexto Links

**What:** Adicionar validação de ambiente para base pública, tentativas de geração e TTL do cache, incluindo valores de desenvolvimento no Compose.  
**Where:** `src/environment.validation.ts`, testes co-localizados, `.env.example`, `docker-compose.yml`  
**Depends on:** Nenhuma  
**Reuses:** `validateEnvironment()` e os padrões de variáveis de autenticação existentes.  
**Requirements:** LINKS-010, NFR-LINKS-005  

**Tools:**

- MCP: Nenhum (Context7 indisponível)
- Skills: `tlc-spec-driven`, `codenavi`

**Done when:**

- [x] `PUBLIC_SHORT_URL_BASE` aceita apenas origem HTTPS sem caminho além de `/`, query string, fragmento ou credenciais.
- [x] `LINK_CODE_GENERATION_MAX_ATTEMPTS` e `LINK_RESOLUTION_CACHE_TTL_SECONDS` são inteiros positivos com os defaults definidos no design.
- [x] `AppEnvironment`, `.env.example` e os serviços Compose que executam bootstrap recebem as novas variáveis.
- [x] Testes unitários cobrem configurações válidas, ausentes e inválidas.
- [x] Gate passa sem remover testes existentes.

**Tests:** unit  
**Gate:** `docker compose exec api npm run test -- --runInBand`  
**Verify:** a suíte unitária passa e a configuração inválida falha no bootstrap com mensagem explícita.  
**Status:** ✅ Complete

---

### T2: Implementar Value Object de URL de Destino

**What:** Criar o Value Object imutável que valida e canonicaliza URL de Destino.  
**Where:** `src/modules/links/destination-url.value-object.ts`, teste co-localizado  
**Depends on:** T1  
**Reuses:** padrão `Email.create()` e `Password.create()` em `src/modules/auth/`.  
**Requirements:** LINKS-004, LINKS-006  

**Tools:**

- MCP: Nenhum (Context7 indisponível)
- Skills: `tlc-spec-driven`, `codenavi`

**Done when:**

- [ ] Aceita somente URLs absolutas HTTP/HTTPS sem usuário ou senha.
- [ ] Persiste a serialização da URL API e rejeita valor canônico acima de 2.048 caracteres.
- [ ] Preserva path, query string e fragmento na URL canônica.
- [ ] Não realiza qualquer chamada de rede.
- [ ] Testes cobrem esquemas inválidos, credenciais, canonicalização, limite e imutabilidade.

**Tests:** unit  
**Gate:** `docker compose exec api npm run test -- --runInBand`  
**Verify:** testes comprovam que URLs equivalentes pela URL API produzem o mesmo valor canônico.

---

### T3: Implementar gerador criptográfico de Código Encurtado

**What:** Criar a abstração e implementação Node.js para gerar códigos alfanuméricos em maiúsculas.  
**Where:** `src/modules/links/link-code-generator.service.ts`, `src/modules/links/node-link-code-generator.service.ts`, testes co-localizados  
**Depends on:** T2  
**Reuses:** `AuthCryptoService` e `NodeAuthCryptoService` como padrão de abstração para `node:crypto`.  
**Requirements:** LINKS-003  

**Tools:**

- MCP: Nenhum (Context7 indisponível)
- Skills: `tlc-spec-driven`, `codenavi`

**Done when:**

- [ ] A interface não expõe detalhes de `node:crypto`.
- [ ] A implementação gera exatamente seis caracteres de `A-Z0-9`.
- [ ] A implementação usa fonte criptograficamente segura.
- [ ] Testes verificam formato, tamanho e rejeitam dependência de geração previsível.

**Tests:** unit  
**Gate:** `docker compose exec api npm run test -- --runInBand`  
**Verify:** todos os valores gerados atendem a `/^[A-Z0-9]{6}$/`.

---

### T4: Implementar cache Redis de resolução

**What:** Criar a abstração e implementação Redis do cache-aside de resolução com TTL configurável.  
**Where:** `src/modules/links/link-resolution-cache.service.ts`, `src/modules/links/redis-link-resolution-cache.service.ts`, testes de integração  
**Depends on:** T1  
**Reuses:** `RedisModule`, `RedisService` e convenções de chave de `redis-auth-state.service.ts`.  
**Requirements:** NFR-LINKS-002, NFR-LINKS-004  

**Tools:**

- MCP: Nenhum (Context7 indisponível)
- Skills: `tlc-spec-driven`, `codenavi`

**Done when:**

- [ ] A chave segue o prefixo `shortlink:links:resolution:{shortCode}`.
- [ ] O cache grava somente URL de Destino canônica e aplica TTL nativo configurado.
- [ ] Leitura ausente retorna `null` e invalidação remove a chave.
- [ ] Falhas de Redis são propagadas ao chamador para que o serviço escolha fallback ou bloqueio de mutação.
- [ ] Testes de integração cobrem set/get, TTL, invalidação e indisponibilidade.

**Tests:** integration  
**Gate:** `docker compose exec api npm run test:integration -- --runInBand`  
**Verify:** o Redis do Compose contém a chave esperada, respeita TTL e não a retorna após invalidação.

---

### T5: Criar modelo persistente e migration de Links

**What:** Criar enum, entidade e migration gerada para a tabela `links` com constraints e índices definidos no design.  
**Where:** `src/modules/links/link-status.enum.ts`, `src/modules/links/link.entity.ts`, `src/migrations/`, teste de integração  
**Depends on:** T2  
**Reuses:** `AccountEntity`, entidades de autenticação e scripts TypeORM existentes.  
**Requirements:** LINKS-002, LINKS-003, LINKS-006, NFR-LINKS-003, NFR-LINKS-005  

**Tools:**

- MCP: Nenhum (Context7 indisponível)
- Skills: `tlc-spec-driven`, `codenavi`

**Done when:**

- [ ] `links` possui UUID público, FK para `users`, URL canônica, código, estado e timestamps.
- [ ] Existem constraints únicas para `shortCode` e `(userId, destinationUrl)`.
- [ ] Existem índices para listagem determinística e contagem de Links Ativos.
- [ ] A migration é gerada pelo CLI TypeORM, aplica e reverte contra PostgreSQL.
- [ ] Testes de integração validam schema, constraints e FK.

**Tests:** integration  
**Gate:** `docker compose exec api npm run test:integration -- --runInBand`  
**Verify:** gerar/aplicar/reverter migration funciona no container e as constraints rejeitam duplicidades.

---

### T6: Implementar repositório TypeORM de Links

**What:** Definir o contrato do repositório e implementar criação/restauração, listagem e transições de estado com transações.  
**Where:** `src/modules/links/links.repository.ts`, `typeorm-links.repository.ts`, `links.types.ts`, testes de integração  
**Depends on:** T5  
**Reuses:** `TypeormAuthRepository`, `AccountEntity` e lock pessimista de conta.  
**Requirements:** LINKS-002, LINKS-005, LINKS-006, LINKS-007, NFR-LINKS-002, NFR-LINKS-003  

**Tools:**

- MCP: Nenhum (Context7 indisponível)
- Skills: `tlc-spec-driven`, `codenavi`

**Done when:**

- [ ] A abstração não importa TypeORM, entidades ou tipos HTTP.
- [ ] Criação e reativação bloqueiam a conta, preservam o limite de dez Links Ativos e retornam resultados distintos para criado, existente, reativado e limite excedido.
- [ ] Listagem filtra por proprietário/estado, pagina e ordena por `createdAt DESC, id DESC`.
- [ ] Mudanças de estado diferenciam Link inexistente, Link de outro Usuário, estado já aplicado e limite excedido.
- [ ] Testes de integração cobrem propriedade, deduplicação, paginação, concorrência pela décima vaga e unicidade global de código.

**Tests:** integration  
**Gate:** `docker compose exec api npm run test:integration -- --runInBand`  
**Verify:** requisições concorrentes ao repositório não deixam um Usuário com mais de dez Links Ativos.

---

### T7: Implementar casos de uso de Links

**What:** Criar `LinksService` para orquestrar URL canônica, geração/retry de código, composição da URL Curta, cache e erros de domínio.  
**Where:** `src/modules/links/links.service.ts`, teste co-localizado  
**Depends on:** T3, T4, T6  
**Reuses:** envelope de exceções e padrões de `AuthService`.  
**Requirements:** LINKS-003–LINKS-007, LINKS-010, NFR-LINKS-001–NFR-LINKS-003  

**Tools:**

- MCP: Nenhum (Context7 indisponível)
- Skills: `tlc-spec-driven`, `codenavi`

**Done when:**

- [ ] Criação repete a transação inteira somente para colisão global de código e respeita o máximo configurado.
- [ ] Criação compõe URL Curta exclusivamente pela base validada.
- [ ] Resolução usa cache hit, fallback ao PostgreSQL em cache miss/falha e preenche cache após leitura autoritativa.
- [ ] Desativação e reativação invalidam Redis antes de chamar o repositório; falha de invalidação resulta em `503 LINK_CACHE_UNAVAILABLE` sem mutação.
- [ ] Resultados de propriedade, inexistência, limite e código esgotado são traduzidos nos códigos HTTP do design.
- [ ] Testes unitários cobrem todos os ramos, especialmente fallback de resolução e invalidação estrita.

**Tests:** unit  
**Gate:** `docker compose exec api npm run test -- --runInBand`  
**Verify:** mocks comprovam que o repositório não é chamado para transição de estado após falha de `invalidate`.

---

### T8: Publicar operações autenticadas de gestão

**What:** Criar DTOs, controller e módulo NestJS para criar, listar, desativar e reativar Links próprios.  
**Where:** `src/modules/links/links.dto.ts`, `links.controller.ts`, `links.module.ts`, `src/app.module.ts`, testes E2E  
**Depends on:** T7  
**Reuses:** `AuthSessionGuard`, `AuthenticatedRequest`, `AuthModule`, `ApiExceptionFilter` e harness E2E de autenticação.  
**Requirements:** LINKS-001, LINKS-007, LINKS-008, NFR-LINKS-001, NFR-LINKS-004  

**Tools:**

- MCP: Nenhum (Context7 indisponível)
- Skills: `tlc-spec-driven`, `codenavi`

**Done when:**

- [ ] As quatro rotas de gestão estão sob `/api/v1/links` e usam `AuthSessionGuard`.
- [ ] DTOs aceitam somente campos e enumerações previstas, usando o pipe global para `422`.
- [ ] A resposta de criação usa `201` para novo Link e `200` para Link existente ou reativado.
- [ ] Listagem expõe `{ items, meta }` com paginação, filtro e ordenação definidos.
- [ ] E2E cobre autorização, isolamento entre Usuários, erros de validação, limite, idempotência e ciclo de vida.

**Tests:** e2e  
**Gate:** `docker compose exec api npm run test:e2e -- --runInBand`  
**Verify:** um Usuário autenticado não consegue listar nem mudar o estado de Link pertencente a outro Usuário.

---

### T9: Publicar resolução pública e exclusão do prefixo

**What:** Criar controller público de resolução, excluir `GET /:code` do prefixo global e alinhar o harness E2E ao bootstrap real.  
**Where:** `src/modules/links/link-resolve.controller.ts`, `src/main.ts`, `test/e2e/create-e2e-app.ts`, `test/e2e/app.e2e-spec.ts`, `test/e2e/links.e2e-spec.ts`  
**Depends on:** T8  
**Reuses:** `configureApp()`, cliente HTTPS confiável e `LinksService.resolve()`.  
**Requirements:** LINKS-009, NFR-LINKS-001, NFR-LINKS-004  

**Tools:**

- MCP: Nenhum (Context7 indisponível)
- Skills: `tlc-spec-driven`, `codenavi`

**Done when:**

- [ ] `GET /{code}` válido responde `302` com `Location` igual à URL canônica.
- [ ] Código malformado, inexistente ou desativado responde `404 LINK_NOT_FOUND` sem autenticação.
- [ ] A exclusão do prefixo não altera as rotas existentes sob `/api/v1`.
- [ ] O harness E2E usa `configureApp()` para testar a configuração efetiva de bootstrap.
- [ ] E2E HTTPS cobre cache hit, cache miss, invalidação por desativação e resolução após reativação.

**Tests:** e2e  
**Gate:** `docker compose exec api npm run test:e2e -- --runInBand`  
**Verify:** `GET /ABC123` redireciona sem Bearer e `GET /api/v1/links` permanece protegido.

---

### T10: Documentar e validar a feature completa

**What:** Atualizar documentação operacional e matriz de testes para Links, depois executar o gate completo sem ampliar o escopo.  
**Where:** `README.md`, `.env.example`, `.specs/codebase/TESTING.md`, `.specs/features/links/{spec,design,tasks}.md`  
**Depends on:** T9  
**Reuses:** Gate completo existente e documentação da feature Auth.  
**Requirements:** LINKS-001–LINKS-010, NFR-LINKS-001–NFR-LINKS-005  

**Tools:**

- MCP: Nenhum
- Skills: `tlc-spec-driven`

**Done when:**

- [ ] README e `.env.example` documentam base pública, tentativas de código e TTL do cache.
- [ ] Matriz de testes inclui o contexto Links e a invalidação estrita de Redis.
- [ ] SPEC e design registram estado de implementação somente com evidência dos gates.
- [ ] Lint, build, unitários, integração e E2E passam sem testes removidos ou marcados como skip.

**Tests:** unit, integration, e2e  
**Gate:** `docker compose exec api npm run lint && docker compose exec api npm run build && docker compose exec api npm run test -- --runInBand && docker compose exec api npm run test:integration -- --runInBand && docker compose exec api npm run test:e2e -- --runInBand`  
**Verify:** todos os comandos terminam com código zero dentro do serviço `api`.

## Mapa de execução

```text
Fase 1 — Fundação:
  T1 → T2 → T3
  └──→ T4

Fase 2 — Persistência:
  T2 → T5 → T6

Fase 3 — Casos de uso e HTTP:
  T6 + T3 + T4 → T7 → T8 → T9

Fase 4 — Encerramento:
  T9 → T10
```

Não há tarefas paralelas: os gates exigem execução sequencial e as tarefas compartilham configuração, schema, cache e o mesmo bounded context.

## Verificação pré-aprovação

### Granularidade

| Tarefa | Escopo | Status |
| --- | --- | --- |
| T1 | Configuração validada do contexto | OK |
| T2 | Value Object de URL | OK |
| T3 | Gerador de código | OK |
| T4 | Adapter Redis de cache | OK |
| T5 | Modelo persistente e migration gerada | OK |
| T6 | Repositório transacional | OK |
| T7 | Casos de uso do domínio | OK |
| T8 | Endpoints autenticados | OK |
| T9 | Endpoint público e bootstrap | OK |
| T10 | Documentação e gate final | OK |

### Diagrama × dependências

| Tarefa | Dependências declaradas | Mapa mostra | Status |
| --- | --- | --- | --- |
| T1 | Nenhuma | início | OK |
| T2 | T1 | T1 → T2 | OK |
| T3 | T2 | T2 → T3 | OK |
| T4 | T1 | T1 → T4 | OK |
| T5 | T2 | T2 → T5 | OK |
| T6 | T5 | T5 → T6 | OK |
| T7 | T3, T4, T6 | T3 + T4 + T6 → T7 | OK |
| T8 | T7 | T7 → T8 | OK |
| T9 | T8 | T8 → T9 | OK |
| T10 | T9 | T9 → T10 | OK |

### Co-localização de testes

| Tarefa | Camada modificada | Matriz exige | Task define | Status |
| --- | --- | --- | --- | --- |
| T1 | Configuração e Value Object de ambiente | Unitário | Unitário | OK |
| T2 | Value Object | Unitário | Unitário | OK |
| T3 | Serviço de geração | Unitário | Unitário | OK |
| T4 | Redis adapter | Integração | Integração | OK |
| T5 | Entidade e migration | Integração | Integração | OK |
| T6 | Repositório e transações | Integração | Integração | OK |
| T7 | Serviço de domínio | Unitário | Unitário | OK |
| T8 | Endpoints de gestão | E2E | E2E | OK |
| T9 | Endpoint público e bootstrap | E2E | E2E | OK |
| T10 | Documentação e validação transversal | Unitário, integração e E2E | Unitário, integração e E2E | OK |
