# Design: Core de Links Encurtados

**SPEC:** `.specs/features/links/spec.md`  
**Contexto:** `.specs/features/links/context.md`  
**Status:** Implementado — gate completo aprovado  
**Criado em:** 14 de julho de 2026

## Contexto e pesquisa

O contexto `Links` é um novo bounded context no monólito modular. Ele reutiliza autenticação, bootstrap HTTP, PostgreSQL, Redis, TypeORM e os três níveis de testes já estabelecidos por `Auth`. PostgreSQL permanece a fonte de verdade para Links e Redis é usado somente como cache distribuído da resolução pública.

A pesquisa confirmou:

- NestJS suporta excluir uma rota específica do prefixo global por `setGlobalPrefix(..., { exclude })`; `GET /:code` usará esse mecanismo para ficar fora de `/api/v1`.
- TypeORM com PostgreSQL suporta lock pessimista de escrita em transações; o repositório de autenticação já usa esse padrão ao bloquear a conta.
- Não há padrão de paginação, cache de Links ou variável de base pública no repositório; esta feature os introduz de forma explícita.

Context7 não está disponível neste workspace. A decisão sobre exclusão de prefixo foi confirmada na documentação oficial do NestJS e a de lock pessimista, na documentação oficial do TypeORM.

## Visão da arquitetura

`LinksModule` mantém o domínio de Links isolado de HTTP e TypeORM. O controller de gestão recebe requisições autenticadas; o controller de resolução recebe apenas o Código Encurtado público. `LinksService` depende da abstração `LinksRepository` e do gerador de código, enquanto a implementação TypeORM realiza transações, locks e persistência.

O cache segue o padrão cache-aside. Uma resolução consulta Redis antes do PostgreSQL; em cache miss, lê apenas Link Ativo no banco e popula Redis. Antes de desativação ou reativação, a chave do Código Encurtado é invalidada. Falhas de Redis não impedem a resolução, que usa fallback para PostgreSQL, mas impedem essas transições de estado para preservar a garantia de que Link Desativado não seja resolvido por valor obsoleto.

```mermaid
flowchart LR
    Client[Cliente autenticado] --> Guard[AuthSessionGuard]
    Guard --> Management[LinksController<br/>/api/v1/links]
    Management --> Service[LinksService]
    Service --> Generator[LinkCodeGenerator]
    Service --> Repository[LinksRepository]
    Repository --> Postgres[(PostgreSQL)]

    Visitor[Visitante] --> Resolver[LinkResolveController<br/>/{code}]
    Resolver --> Service
    Service --> ResolutionCache[LinkResolutionCache]
    ResolutionCache --> Redis[(Redis)]
    Service --> Repository
    Resolver --> Redirect[HTTP 302 Location]
```

## Limites de responsabilidade

| Componente | Responsabilidade |
| --- | --- |
| `LinksController` | Validar DTOs, obter o principal autenticado e traduzir resultados em respostas HTTP. |
| `LinkResolveController` | Validar o formato do código para tratá-lo como não encontrado, consultar Link Ativo e emitir `302`. |
| `LinksService` | Orquestrar criação, listagem, transição de estado e resolução; aplicar regras de domínio e traduzir resultados para erros HTTP. |
| `DestinationUrl` | Validar e canonicalizar a URL de Destino sem executar requisições externas. |
| `LinkCodeGenerator` | Gerar códigos aleatórios de seis caracteres com fonte criptograficamente segura. |
| `LinksRepository` | Expor operações do domínio sem tipos TypeORM ou HTTP. |
| `TypeormLinksRepository` | Executar transações, lock pessimista da conta, consultas, paginação e persistência. |
| `LinkResolutionCache` | Guardar e invalidar entradas de resolução pública, sem definir a existência ou estado de um Link. |
| `LinkEntity` | Representar a persistência da tabela `links`. |

## Reuso de código

| Componente existente | Localização | Uso no contexto Links |
| --- | --- | --- |
| `AuthSessionGuard` | `src/modules/auth/auth-session.guard.ts` | Proteger operações de gestão e preencher `request.user`. |
| `AuthModule` | `src/modules/auth/auth.module.ts` | Exportar e disponibilizar o guard ao `LinksModule`. |
| `AccountEntity` | `src/modules/auth/account.entity.ts` | Ser FK do Link e linha bloqueada nas transações por Usuário. |
| Padrão de repositório TypeORM | `src/modules/auth/typeorm-auth.repository.ts` | Transações e `pessimistic_write` sobre a conta. |
| Filtro de exceção | `src/api-exception.filter.ts` | Manter o envelope de erros consolidado. |
| Bootstrap HTTP | `src/main.ts` | Excluir a rota pública do prefixo global e manter validação global. |
| Ambiente validado | `src/environment.validation.ts` | Incluir base pública e máximo de tentativas de código. |
| Cliente Redis | `src/redis.module.ts`, `src/redis.service.ts` | Implementar cache distribuído de resolução. |
| Harnesses de teste | `test/integration/`, `test/e2e/` | Reutilizar migrations, limpeza de banco/Redis e cliente HTTPS confiável. |

## Estrutura de arquivos

```text
src/
  modules/
    links/
      links.module.ts
      links.controller.ts
      register-public-link-resolve.ts
      links.service.ts
      links.repository.ts
      typeorm-links.repository.ts
      links.dto.ts
      links.types.ts
      link.entity.ts
      link-status.enum.ts
      destination-url.value-object.ts
      link-code-generator.service.ts
      node-link-code-generator.service.ts
      link-resolution-cache.service.ts
      redis-link-resolution-cache.service.ts
      destination-url.value-object.spec.ts
      node-link-code-generator.service.spec.ts
      links.service.spec.ts
  migrations/
    <timestamp>-CreateLinksTable.ts
  app.module.ts
  environment.validation.ts
  main.ts

test/
  integration/
    typeorm-links.repository.integration-spec.ts
  e2e/
    links.e2e-spec.ts
```

A migration será gerada pelo TypeORM CLI a partir de `LinkEntity`; não será escrita manualmente.

## Roteamento HTTP

### Gestão autenticada

`LinksController` usará `@Controller('links')`. Com o prefixo global, as rotas são:

| Método e rota | DTO/entrada | Resultado |
| --- | --- | --- |
| `POST /api/v1/links` | `destinationUrl` | `201` com Link criado, ou `200` com Link existente/reativado |
| `GET /api/v1/links` | `page`, `limit`, `status` | `200` com `{ items, meta }` |
| `PATCH /api/v1/links/:linkId/deactivate` | `linkId` UUID | `200` com Link |
| `PATCH /api/v1/links/:linkId/reactivate` | `linkId` UUID | `200` com Link |

Todas usam `AuthSessionGuard`, leem `request.user.userId` a partir de `AuthenticatedRequest` e não usam refresh cookie; portanto, não exigem `CsrfOriginGuard`.

### Resolução pública

A resolução pública é registrada por `registerPublicLinkResolve()` dentro de `configureApp()` como middleware Express antecipado em `GET /:code`.

**SPEC_DEVIATION:** o design original previa `setGlobalPrefix('api/v1', { exclude: [{ path: ':code', method: RequestMethod.GET }] })`. Em NestJS 10, o padrão `:code` também remove o prefixo de `GET /links`, quebrando `/api/v1/links`. O middleware antecipado preserva o prefixo da API e atende `GET /{code}` com `302`/`404 LINK_NOT_FOUND`.

Códigos fora de `[A-Z0-9]{6}` não consultam o banco e retornam o mesmo `404 LINK_NOT_FOUND` de código inexistente ou Link Desativado.

O Nginx já encaminha todos os caminhos para a API e não precisa de alteração. O healthcheck atual tolera respostas entre `200` e `499`; portanto, `GET /` continuar sem rota não reduz a saúde do container.

## Componentes e interfaces

### `DestinationUrl`

- **Localização:** `src/modules/links/destination-url.value-object.ts`
- **Papel:** encapsular parsing, política de aceitação e valor canônico da URL de Destino.
- **Interface:**
  - `DestinationUrl.create(raw: string): DestinationUrl`
  - `value(): string`
- **Regras:**
  - usa a URL API nativa para serialização;
  - aceita somente `http:` e `https:`;
  - rejeita `username` e `password`;
  - rejeita valor canônico acima de 2.048 caracteres;
  - preserva path, query string e fragmento da serialização;
  - não realiza chamadas de rede.
- **Reuso:** segue o padrão de Value Object imutável de `Email` e `Password`.

### `LinkCodeGenerator`

- **Localização:** `link-code-generator.service.ts` e `node-link-code-generator.service.ts`
- **Papel:** separar a geração criptograficamente segura de Código Encurtado da regra de criação.
- **Interface:**
  - `generate(): string`
- **Implementação:** usa `node:crypto` para selecionar seis caracteres do alfabeto `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`.
- **Regra:** a geração não garante unicidade; a constraint do banco é a garantia definitiva.

### `LinksRepository`

- **Localização:** `src/modules/links/links.repository.ts`
- **Papel:** definir operações de Link em termos de records e inputs do contexto.
- **Interfaces principais:**
  - `createOrRestore(userId, destinationUrl, shortCode): Promise<CreateOrRestoreLinkResult>`
  - `listByUser(userId, query): Promise<PaginatedLinks>`
  - `changeStatus(userId, linkId, status): Promise<ChangeLinkStatusResult>`
  - `findActiveByShortCode(shortCode): Promise<LinkRecord | null>`
- **Regra:** não importa TypeORM, entidades ou tipos HTTP.

### `LinkResolutionCache`

- **Localização:** `link-resolution-cache.service.ts` e `redis-link-resolution-cache.service.ts`
- **Papel:** isolar o cache distribuído usado exclusivamente pela resolução pública.
- **Interface:**
  - `get(shortCode: string): Promise<string | null>`
  - `set(shortCode: string, destinationUrl: string): Promise<void>`
  - `invalidate(shortCode: string): Promise<void>`
- **Implementação:** usa `RedisService` e a chave `shortlink:links:resolution:{shortCode}`, com TTL de 300 segundos. O valor contém somente a URL de Destino canônica.
- **Regra:** cache hit representa uma otimização de leitura; cache miss ou falha não definem existência, propriedade ou estado. Redis indisponível produz fallback para PostgreSQL na resolução. Para desativação e reativação, falha de invalidação aborta a operação antes de qualquer mutação no PostgreSQL.

### `TypeormLinksRepository`

- **Localização:** `src/modules/links/typeorm-links.repository.ts`
- **Papel:** implementar `LinksRepository` com `DataSource`, `LinkEntity` e `AccountEntity`.
- **Criação/restauração:**
  1. inicia transação;
  2. bloqueia a linha de `users` do proprietário com `pessimistic_write`;
  3. busca a associação `(userId, destinationUrl)`;
  4. retorna Link Ativo existente, ou reativa Link Desativado caso a contagem de ativos seja inferior a dez;
  5. se não existir associação, conta Links Ativos e insere o novo Link quando houver capacidade;
  6. comita o resultado sem expor entidades TypeORM.
- **Mudança de estado:** localiza o Link, retorna resultado distinto para inexistente e não pertencente ao Usuário, bloqueia a conta proprietária e aplica desativação/reativação de forma idempotente.
- **Concorrência:** o lock da conta serializa todas as operações que podem alterar a capacidade do mesmo Usuário. Constraints de banco permanecem a defesa definitiva para duplicidade e colisão global de código.

### `LinksService`

- **Localização:** `src/modules/links/links.service.ts`
- **Papel:** coordenar casos de uso e mapear resultados do repositório em respostas e exceções de domínio.
- **Interfaces:**
  - `create(userId, input): Promise<CreateLinkResponse>`
  - `list(userId, query): Promise<PaginatedLinkResponse>`
  - `deactivate(userId, linkId): Promise<LinkResponse>`
  - `reactivate(userId, linkId): Promise<LinkResponse>`
  - `resolve(shortCode): Promise<string>`
- **Colisão de código:** chama o gerador e tenta `createOrRestore`; ao receber colisão de `shortCode`, reinicia a tentativa completa até `LINK_CODE_GENERATION_MAX_ATTEMPTS`. Ao esgotar, retorna `503 SHORT_CODE_GENERATION_UNAVAILABLE`, sem gravar estado parcial.
- **URL Curta:** compõe `{PUBLIC_SHORT_URL_BASE}/{shortCode}` exclusivamente a partir da configuração validada.
- **Cache:** popula o cache após uma resolução bem-sucedida no PostgreSQL. Antes de desativação ou reativação, invalida a chave; se a invalidação falhar, retorna `503 LINK_CACHE_UNAVAILABLE` e não chama a mutação no repositório. Falhas de leitura/escrita durante resolução são registradas e usam fallback ao PostgreSQL.

### Controllers e DTOs

- **Localização:** `links.controller.ts`, `link-resolve.controller.ts` e `links.dto.ts`
- **DTOs:**
  - `CreateLinkDto` recebe `destinationUrl`;
  - `ListLinksQueryDto` recebe `page`, `limit` e `status` (`active`, `deactivated`, `all`);
  - `LinkIdParamDto` valida o UUID de gestão;
  - `ResolveLinkParamDto` não usa o pipe global para erro de formato: o controller trata formato inválido como `404`.
- **Paginação:** `page` padrão 1, `limit` padrão 20 e máximo 100; resposta `{ items, meta: { page, limit, total, totalPages } }`; ordenação `createdAt DESC, id DESC`.

## Modelo de dados

### `links`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | UUID v4 | Chave primária e identificador público não sequencial de gestão. |
| `userId` | UUID | FK para `users.id`, obrigatória, `ON DELETE CASCADE`. |
| `shortCode` | `varchar(6)` | Obrigatório e único globalmente. |
| `destinationUrl` | `varchar(2048)` | Obrigatório; valor canônico de `DestinationUrl`. |
| `status` | `varchar(16)` | `ACTIVE` ou `DEACTIVATED`; padrão `ACTIVE`. |
| `createdAt` | `timestamptz` | Data de criação. |
| `updatedAt` | `timestamptz` | Data da última mudança. |

Índices e constraints:

- `UNIQUE (shortCode)`;
- `UNIQUE (userId, destinationUrl)`;
- índice para listagem por `userId`, `createdAt` e `id`;
- índice parcial de Links Ativos por `userId` para apoiar a contagem dentro da transação.

O estado do Link será representado pelo enum `LinkStatus`. O `id` UUID é público e não equivale ao Código Encurtado: ele é usado somente nas rotas autenticadas de gestão.

## Fluxos e concorrência

### Criar ou restaurar Link

1. Controller valida o corpo; `DestinationUrl` canonicaliza a URL.
2. Service gera um Código Encurtado e chama o repositório.
3. O repositório bloqueia a Conta do Usuário.
4. Se houver Link Ativo para a URL canônica, retorna-o sem usar o código candidato.
5. Se houver Link Desativado, conta os ativos: se houver vaga, reativa o mesmo Link; caso contrário, retorna limite excedido.
6. Sem Link anterior, conta os ativos e cria novo Link se houver vaga.
7. Uma colisão de código global aborta a transação; o service gera outro código e repete o fluxo até o máximo configurado.

### Desativar e reativar

1. O repositório verifica se o Link existe e se pertence ao principal autenticado.
2. O Link inexistente retorna `LINK_NOT_FOUND`; Link de outro Usuário retorna `FORBIDDEN`.
3. A conta é bloqueada na transação.
4. Desativação altera `ACTIVE` para `DEACTIVATED`; se já estiver desativado, retorna sem mudança.
5. Reativação conta ativos e altera para `ACTIVE` somente se houver vaga; se já ativo, retorna sem mudança.

### Resolver URL Curta

1. Controller recebe `GET /:code`.
2. Código inválido resulta em `404 LINK_NOT_FOUND` sem consultar cache ou banco.
3. Para código válido, o service consulta `LinkResolutionCache`; um cache hit retorna a URL de Destino canônica.
4. Em cache miss ou falha do Redis, o service consulta PostgreSQL por Link Ativo. Link inexistente ou desativado resulta em `404 LINK_NOT_FOUND`; Link Ativo é armazenado no cache quando Redis estiver disponível.
5. Controller responde `302` e define `Location` exatamente como a URL canônica encontrada.
6. Não há autenticação, CSRF, leitura de cookie ou fetch da URL de Destino.

### Invalidação de cache

1. Criação de um novo Link Ativo não precisa invalidar cache porque o Código Encurtado possui unicidade global e ainda não possui entrada válida.
2. Desativação invalida a chave antes da transação autoritativa no PostgreSQL. Se Redis falhar, retorna `503 LINK_CACHE_UNAVAILABLE` e não altera o Link.
3. Reativação segue a mesma ordem: invalida a chave antes da transação; após a mudança, a próxima resolução recarrega a URL de Destino a partir do PostgreSQL.
4. Resoluções iniciadas após uma invalidação bem-sucedida consultam PostgreSQL e não redirecionam Link Desativado. Uma resolução que já devolveu cache hit antes da invalidação mantém sua própria ordem de execução.

## Configuração

| Variável | Regra |
| --- | --- |
| `PUBLIC_SHORT_URL_BASE` | Obrigatória; origem HTTPS absoluta, sem usuário, senha, caminho além de `/`, query string ou fragmento. |
| `LINK_CODE_GENERATION_MAX_ATTEMPTS` | Inteiro positivo; padrão documentado de `5`. |
| `LINK_RESOLUTION_CACHE_TTL_SECONDS` | Inteiro positivo; padrão documentado de `300`. |

`AppEnvironment` passa a expor essas configurações. `.env.example` inclui valores de desenvolvimento, com `PUBLIC_SHORT_URL_BASE=https://localhost:${TLS_HOST_PORT}` resolvido em valor explícito compatível com Compose. Os serviços `api` e `queue-worker` recebem as variáveis porque ambos validam o ambiente no bootstrap.

## Estratégia de erros

| Cenário | Status e código | Observação |
| --- | --- | --- |
| Corpo, paginação ou UUID de gestão inválidos | `422 VALIDATION_ERROR` | Produzido pelo pipe global. |
| URL de Destino inválida | `422 VALIDATION_ERROR` | `DestinationUrl` traduz erro de domínio para o envelope existente. |
| Usuário sem sessão Bearer válida | Contrato de autenticação existente | `AuthSessionGuard`. |
| Limite de dez Links Ativos | `409 LINK_LIMIT_REACHED` | Não altera Link nem capacidade. |
| Link de outro Usuário | `403 FORBIDDEN` | Não modifica o Link. |
| Link inexistente | `404 LINK_NOT_FOUND` | Gestão autenticada. |
| Código público inválido, inexistente ou desativado | `404 LINK_NOT_FOUND` | Não revela o estado do Link. |
| Redis indisponível na invalidação de estado | `503 LINK_CACHE_UNAVAILABLE` | Desativação/reativação não altera PostgreSQL. |
| Colisões além do máximo de tentativas | `503 SHORT_CODE_GENERATION_UNAVAILABLE` | Sem persistência parcial. |
| Falha inesperada | `500 INTERNAL_SERVER_ERROR` | Filtro global e logs sanitizados. |

## Testes

| Camada | Cobertura |
| --- | --- |
| Unitário | `DestinationUrl`, gerador de código, composição da URL Curta e mapeamento de resultados do repositório pelo service. |
| Integração | Migration gerada, constraints, paginação, propriedade, lock de conta, limite de dez, deduplicação, colisão de código, chaves Redis, TTL, invalidação, fallback na resolução e bloqueio de desativação/reativação quando Redis está indisponível. |
| E2E | Gestão por Bearer via HTTPS, isolamento entre Usuários, filtros/paginação, desativação/reativação e `GET /{code}` com `302`/`Location`. |

O setup de integração deve incluir `links` na limpeza entre testes. O setup E2E deve executar `configureApp()` para testar a exclusão do prefixo exatamente como o bootstrap de produção.

## Decisões técnicas

| Decisão | Escolha | Motivo |
| --- | --- | --- |
| Publicação da rota de resolução | Exclusão de `GET /:code` do prefixo global NestJS | Mantém gestão versionada e URL Curta em `/{code}` sem camada extra no Nginx. |
| Identificador de gestão | UUID v4 da chave primária | Segue o padrão das entidades existentes e não expõe identificador sequencial. |
| Consistência do limite | Lock pessimista da conta no PostgreSQL | Reutiliza o padrão de sessão única do Auth e serializa mudanças de capacidade por Usuário. |
| Deduplicação | Unique `(userId, destinationUrl)` | Garante um único Link por URL canônica e Usuário em qualquer estado. |
| Colisão de código | Unique global + repetição transacional limitada | O banco garante unicidade; o cliente não observa colisões transitórias. |
| Cache de resolução | Cache-aside em Redis, TTL de 300 segundos e invalidação estrita antes de transições de estado | Reduz leituras públicas no PostgreSQL sem permitir mutação que possa deixar valor obsoleto servível. |
| URL Curta | Base de ambiente validada | Não confia em cabeçalhos de host/protocolo fornecidos pela requisição. |

## Rastreabilidade

| Requisito | Componentes de design |
| --- | --- |
| LINKS-001 | `LinksModule`, controllers, service e repositório abstrato. |
| LINKS-002 | `LinkEntity`, `LinkStatus`, FK e constraints. |
| LINKS-003 | `LinkCodeGenerator`, unique global e repetição limitada. |
| LINKS-004 | `DestinationUrl` e `CreateLinkDto`. |
| LINKS-005 | `TypeormLinksRepository`, lock da conta e contagem de ativos. |
| LINKS-006 | Fluxo `createOrRestore` e unique `(userId, destinationUrl)`. |
| LINKS-007 | `AuthSessionGuard`, `LinksController` e paginação. |
| LINKS-008 | DTOs, controllers e `ApiExceptionFilter`. |
| LINKS-009 | `LinkResolveController` e exclusão no `configureApp()`. |
| LINKS-010 | `AppEnvironment`, `.env.example` e composição de URL Curta. |
| NFR-LINKS-001 | Guard, verificação de propriedade e resolução opaca. |
| NFR-LINKS-002 | PostgreSQL como fonte de verdade, `LinkResolutionCache` e fallback ao banco. |
| NFR-LINKS-003 | Locks, constraints e testes concorrentes. |
| NFR-LINKS-004 | Testes unitários, integração e E2E HTTPS. |
| NFR-LINKS-005 | Compose, CLI TypeORM e gates no serviço `api`. |

## Fora de escopo preservado

Este design não inclui aliases personalizados, domínios próprios, tenancy, analytics, exclusão definitiva, edição de URL de Destino ou interface web.
