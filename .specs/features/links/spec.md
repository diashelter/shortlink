# SPEC: Core de Links Encurtados

## Status

- Fase: Execute
- Escopo: Grande
- Estado: Implementada — gate completo aprovado em 14 de julho de 2026
- Criada em: 14 de julho de 2026

## Fontes canônicas

Esta SPEC consolida, nesta ordem de precedência:

1. `CONTEXT.md`
2. `.specs/features/links/context.md`
3. `PROGRESS.md`
4. `.specs/features/authentication/spec.md`

`API para encurtar links multitenant.md` é um documento histórico. Onde divergir desta SPEC — em especial sobre tenancy, tamanho e unicidade do código, formato de erros, rotas e resolução pública — esta SPEC prevalece.

## Problema

Usuários já conseguem criar e autenticar suas contas, mas ainda não podem realizar a finalidade central do produto: associar uma URL de Destino a uma URL Curta pública. O sistema precisa criar esses Links sem expor IDs internos, impedir que um Usuário gerencie recursos de outro e resolver URLs Curtas de forma pública, segura e previsível.

## Objetivos

- Permitir que um Usuário autenticado crie ou recupere idempotentemente um Link para uma URL de Destino válida.
- Disponibilizar uma URL Curta pública com Código Encurtado globalmente único e redirecionamento temporário.
- Permitir que o Usuário liste, desative e reative exclusivamente os Links que criou.
- Impor o máximo de dez Links Ativos por Usuário, mesmo sob requisições concorrentes.
- Preservar os padrões existentes de autenticação, validação, erros, migrations e testes em Docker.

## Fora de escopo

| Item | Motivo |
| --- | --- |
| Alias escolhido pelo Usuário | O Core usa somente Código Encurtado gerado pelo sistema. |
| Domínios próprios, tenant ou namespace por Usuário | A URL Curta inicial usa um Código Encurtado global sob o domínio da plataforma. |
| Métricas, cliques, relatórios e analytics | A resolução não registra eventos nesta entrega. |
| Exclusão definitiva | O ciclo de vida inicial é desativação e reativação reversíveis. |
| Edição de URL de Destino | Alterar o destino é uma capacidade separada e não altera o Link nesta feature. |
| Frontend ou dashboard | A entrega é exclusivamente a API. |
| Rate limit específico para Links | Não há política de produto consolidada; os limites desta entrega são de Links Ativos. |

## Decisões de produto consolidadas

- Um Link pertence a exatamente um Usuário.
- O Código Encurtado é alfanumérico, possui seis caracteres em maiúsculas e é globalmente único.
- A URL Curta usa o formato `{PUBLIC_SHORT_URL_BASE}/{code}`.
- A URL de Destino é absoluta, usa somente `http` ou `https` e não contém credenciais embutidas.
- A URL de Destino canônica aceita até 2.048 caracteres.
- A igualdade da URL de Destino usa sua serialização pela URL API, preservando path, query string e fragmento.
- Um Usuário pode ter no máximo dez Links Ativos.
- Uma criação para uma URL de Destino já vinculada a Link Ativo do mesmo Usuário retorna o Link existente.
- Uma criação para uma URL de Destino vinculada a Link Desativado do mesmo Usuário reativa e retorna esse Link.
- A desativação impede a resolução pública e libera capacidade; a reativação só ocorre quando houver capacidade disponível.
- A resolução pública de Link Ativo retorna redirecionamento HTTP `302`.
- A listagem usa `page` a partir de 1 e `limit` entre 1 e 100, com padrão 20.
- A listagem ordena Links do mais recente para o mais antigo, usando o identificador público como desempate.
- A base pública é uma origem HTTPS sem caminho, query string ou fragmento; o Código Encurtado ocupa `/{code}`.

## Histórias de usuário

### P1: Criar um Link encurtado

**História:** Como Usuário autenticado, quero enviar uma URL de Destino para receber uma URL Curta que eu possa compartilhar.

**Por que P1:** Sem criação não há Link a administrar ou resolver publicamente.

**Critérios de aceite:**

1. QUANDO um Usuário autenticado enviar uma URL de Destino válida para `POST /api/v1/links`, ENTÃO o sistema DEVE criar um Link Ativo, gerar um Código Encurtado globalmente único e retornar sua representação com a URL Curta.
2. QUANDO a URL de Destino for inválida, não for absoluta, usar esquema diferente de `http`/`https`, contiver credenciais embutidas ou exceder 2.048 caracteres após canonicalização, ENTÃO o sistema DEVE retornar `422 VALIDATION_ERROR` e não persistir nem reativar um Link.
3. QUANDO o mesmo Usuário solicitar uma URL de Destino já associada a Link Ativo, ENTÃO o sistema DEVE retornar o Link existente sem gerar código ou consumir capacidade adicional.
4. QUANDO o mesmo Usuário solicitar uma URL de Destino já associada a Link Desativado, ENTÃO o sistema DEVE reativar e retornar esse Link, preservando seu Código Encurtado, desde que haja capacidade disponível.
5. QUANDO o Usuário já possuir dez Links Ativos e a URL de Destino não corresponder a Link Ativo existente, ENTÃO o sistema DEVE rejeitar a operação com `409 LINK_LIMIT_REACHED`.
6. QUANDO duas criações concorrentes disputarem a última posição disponível, ENTÃO no máximo uma delas DEVE criar ou reativar um novo Link Ativo.
7. QUANDO a geração produzir um Código Encurtado já existente, ENTÃO o sistema DEVE tentar outro código sem retornar colisão ao cliente; se as tentativas configuradas se esgotarem, DEVE falhar sem persistência parcial.

**Teste independente:** autenticar um Usuário, criar uma URL de Destino HTTP/HTTPS e confirmar que a resposta contém um Código Encurtado de seis caracteres e uma URL Curta pública.

### P1: Listar Links próprios

**História:** Como Usuário autenticado, quero listar meus Links para acompanhar quais URLs Curtas estão disponíveis.

**Por que P1:** A criação só é utilizável quando o proprietário pode reencontrar os Links criados.

**Critérios de aceite:**

1. QUANDO um Usuário autenticado chamar `GET /api/v1/links` sem filtro, ENTÃO o sistema DEVE retornar a página 1, com até 20 Links Ativos próprios ordenados do mais recente para o mais antigo, usando o identificador público como desempate.
2. QUANDO o Usuário solicitar explicitamente Links Desativados ou todos os estados, ENTÃO o sistema DEVE aplicar o filtro sem incluir Links de outros Usuários.
3. QUANDO `page` for menor que 1, não inteiro, ou `limit` estiver fora do intervalo de 1 a 100, ENTÃO o sistema DEVE retornar `422 VALIDATION_ERROR`.
4. QUANDO não houver Links para o filtro solicitado, ENTÃO o sistema DEVE retornar `items` vazio e `meta` com `page`, `limit`, `total` e `totalPages` válidos.
5. QUANDO um Usuário não autenticado chamar a rota, ENTÃO o sistema DEVE rejeitar a requisição conforme o contrato de autenticação existente.

**Teste independente:** criar Links para dois Usuários, desativar um Link do primeiro e confirmar que cada listagem paginada contém somente os recursos autorizados e o filtro esperado.

### P1: Desativar e reativar Links próprios

**História:** Como Usuário autenticado, quero desativar e reativar meus Links para controlar quais URLs Curtas continuam disponíveis.

**Por que P1:** A capacidade de liberar uma das dez posições e interromper redirecionamentos é parte do limite de produto definido.

**Critérios de aceite:**

1. QUANDO o proprietário desativar um Link Ativo, ENTÃO o sistema DEVE mudar seu estado para desativado, liberar uma posição e impedir futuras resoluções públicas.
2. QUANDO o proprietário reativar um Link Desativado com capacidade disponível, ENTÃO o sistema DEVE restaurar seu estado ativo e preservar seu Código Encurtado e URL de Destino.
3. QUANDO o proprietário tentar reativar um Link sem capacidade disponível, ENTÃO o sistema DEVE retornar `409 LINK_LIMIT_REACHED` e manter o Link Desativado.
4. QUANDO um Usuário tentar desativar ou reativar um Link pertencente a outro Usuário, ENTÃO o sistema DEVE retornar `403 FORBIDDEN`.
5. QUANDO o Link referenciado não existir, ENTÃO o sistema DEVE retornar `404 LINK_NOT_FOUND`.
6. QUANDO uma operação solicitar o estado que o Link já possui, ENTÃO o sistema DEVE ser idempotente e retornar a representação atual sem alterar sua capacidade.

**Teste independente:** criar um Link, desativá-lo, verificar que a URL Curta deixa de resolver, reativá-lo e confirmar que o mesmo Código Encurtado volta a redirecionar.

### P1: Resolver uma URL Curta publicamente

**História:** Como visitante, quero acessar uma URL Curta sem autenticação e chegar à URL de Destino associada.

**Por que P1:** Esse é o comportamento público essencial de um encurtador de URLs.

**Critérios de aceite:**

1. QUANDO qualquer visitante acessar `GET /{code}` com o Código Encurtado de um Link Ativo, ENTÃO o sistema DEVE responder `302` com o cabeçalho `Location` igual à URL de Destino.
2. QUANDO o código não existir, estiver malformado ou pertencer a Link Desativado, ENTÃO o sistema DEVE retornar `404 LINK_NOT_FOUND`, sem revelar a existência ou o proprietário de um Link Desativado.
3. QUANDO a resolução pública for chamada, ENTÃO ela NÃO DEVE exigir access token, refresh token ou proteção CSRF.
4. QUANDO a URL de Destino contiver caracteres que precisem ser preservados, ENTÃO o redirecionamento DEVE manter seu valor validado sem normalização destrutiva.

**Teste independente:** acessar pela origem HTTPS local a URL Curta retornada na criação e confirmar resposta `302` e cabeçalho `Location`, sem cabeçalho `Authorization`.

## Requisitos funcionais

### LINKS-001: Estrutura modular

A implementação DEVE criar um módulo independente `Links`, seguindo o padrão flat do repositório: controller fino, service de casos de uso, interface de repositório definida pelo contexto e implementação TypeORM separada.

### LINKS-002: Modelo e propriedade

Um Link DEVE possuir identificador público não sequencial, referência ao Usuário proprietário, Código Encurtado, URL de Destino, estado ativo/desativado e timestamps. O Código Encurtado DEVE ser único globalmente; a URL de Destino DEVE ser única entre os Links de um mesmo Usuário, independentemente do estado.

### LINKS-003: Geração e colisão do código

O sistema DEVE gerar Código Encurtado com seis caracteres alfanuméricos em maiúsculas usando fonte criptograficamente segura. A unicidade definitiva DEVE ser garantida pelo PostgreSQL, e colisões DEVE ser tratadas por nova tentativa controlada.

### LINKS-004: Validação da URL de Destino

O sistema DEVE validar sintaticamente a URL de Destino, aceitar somente URLs HTTP/HTTPS absolutas, rejeitar credenciais embutidas e limitar o valor canônico a 2.048 caracteres. Sua serialização pela URL API DEVE ser o valor canônico persistido e usado para deduplicação, preservando path, query string e fragmento. A criação e a resolução NÃO DEVEM buscar, pré-visualizar ou executar requisições para a URL de Destino.

### LINKS-005: Limite e concorrência

O sistema DEVE limitar cada Usuário a dez Links Ativos. A criação, reativação e deduplicação DEVEM ser atômicas para manter esse invariante sob concorrência.

### LINKS-006: Criação idempotente pelo destino

Para a mesma URL de Destino e o mesmo Usuário, uma criação DEVE retornar o Link Ativo existente ou reativar o Link Desativado existente. Não DEVE criar múltiplos Links para a mesma associação de Usuário e URL de Destino.

### LINKS-007: Gestão autorizada e listagem

As rotas de criação, listagem, desativação e reativação DEVEM exigir `AuthSessionGuard`. Um Usuário DEVE visualizar e alterar exclusivamente Links de sua propriedade. A listagem DEVE aceitar `page` a partir de 1, `limit` de 1 a 100 com padrão 20 e filtro explícito de estado; sua resposta DEVE usar `items` e `meta` com `page`, `limit`, `total` e `totalPages`, ordenando por criação decrescente e identificador público como desempate.

### LINKS-008: Contrato HTTP

As operações de gestão DEVEM estar sob `/api/v1/links` e manter o envelope de erro existente `{ statusCode, code, message, errors? }`. A representação de Link DEVE conter identificador público, Código Encurtado, URL de Destino, URL Curta, estado e timestamps; não DEVE expor identificadores internos de banco.

| Método e rota | Finalidade | Sucesso |
| --- | --- | --- |
| `POST /api/v1/links` | Criar, retornar ativo existente ou reativar Link por URL de Destino | `201` ao criar; `200` ao reutilizar ou reativar |
| `GET /api/v1/links?page=1&limit=20&status=active` | Listar Links próprios com paginação e filtro de estado | `200` |
| `PATCH /api/v1/links/{linkId}/deactivate` | Desativar Link próprio | `200` |
| `PATCH /api/v1/links/{linkId}/reactivate` | Reativar Link próprio | `200` |
| `GET /{code}` | Resolver URL Curta pública | `302` |

### LINKS-009: Resolução pública

A resolução pública DEVE aceitar somente um Código Encurtado válido de Link Ativo e responder com `302 Location`. O design DEVE definir como publicar `GET /{code}` sem interferir no prefixo global `/api/v1`, nas rotas de healthcheck e nas futuras rotas públicas.

### LINKS-010: Configuração da URL Curta

A base pública da URL Curta DEVE vir de variável obrigatória de ambiente, validada no bootstrap como origem HTTPS sem caminho, query string ou fragmento. O sistema NÃO DEVE construir URLs públicas com host, protocolo ou porta recebidos da requisição.

## Requisitos não funcionais

### NFR-LINKS-001: Segurança e isolamento

Operações autenticadas devem validar a Sessão de Autenticação ativa. O acesso a Link de outro Usuário deve ser recusado. A resolução pública não pode expor URL de Destino, proprietário ou estado de Link inexistente/desativado fora do comportamento definido.

### NFR-LINKS-002: Persistência confiável

PostgreSQL permanece fonte de verdade para Links, propriedade, estado, código e limite. Redis pode ser usado somente como cache de resolução e nunca como fonte de verdade. Antes de desativar ou reativar um Link, a entrada de cache deve ser invalidada; se Redis estiver indisponível, a operação deve responder `503` sem alterar o estado no PostgreSQL.

### NFR-LINKS-003: Consistência concorrente

O banco de dados deve proteger a unicidade do Código Encurtado e da associação Usuário/URL de Destino. O limite de dez Links Ativos deve resistir a criações e reativações concorrentes.

### NFR-LINKS-004: Testabilidade

Cada regra de domínio deve ter teste unitário ou de integração. Persistência, índices, unicidade e concorrência devem ter testes de integração. Todos os endpoints de gestão e a resolução pública devem ter testes E2E HTTPS.

### NFR-LINKS-005: Operação em Docker

Build, lint, migrations e testes devem executar pelo serviço `api` do Docker Compose. A migration de Links deve ser gerada pelo CLI TypeORM; migrations não serão escritas manualmente.

## Casos de borda

- QUANDO URLs de Destino diferirem apenas por normalizações feitas pela serialização da URL API, ENTÃO o sistema deve tratá-las como a mesma associação de Usuário e URL de Destino.
- QUANDO um Código Encurtado colidir, ENTÃO a transação não pode deixar Link parcial nem exceder o limite.
- QUANDO um Link for desativado entre a busca e a resolução pública, ENTÃO a resposta não pode redirecionar um Link já desativado.
- QUANDO Redis estiver indisponível antes de desativar ou reativar um Link, ENTÃO o sistema deve retornar `503` e preservar o estado persistido do Link.
- QUANDO criação e reativação concorrerem para a mesma URL de Destino, ENTÃO o resultado deve preservar um único Link do Usuário para esse destino.
- QUANDO um Usuário atingir dez Links Ativos e desativar um deles, ENTÃO a próxima criação ou reativação elegível pode ocupar exatamente uma posição.
- QUANDO a base pública configurada tiver barra final, ENTÃO a URL Curta retornada não pode conter barra duplicada.
- QUANDO a base pública não for uma origem HTTPS sem caminho, query string ou fragmento, ENTÃO a aplicação deve falhar no bootstrap.

## Rastreabilidade de requisitos

| ID | Origem | História | Próxima fase | Estado |
| --- | --- | --- | --- | --- |
| LINKS-001 | Convenções do projeto | Todas | Design | Pendente |
| LINKS-002 | `CONTEXT.md` | Criar, gerir | Design | Pendente |
| LINKS-003 | Decisão consolidada | Criar | Design | Pendente |
| LINKS-004 | Decisão consolidada | Criar, resolver | Design | Pendente |
| LINKS-005 | Limite de produto | Criar, gerir | Design | Pendente |
| LINKS-006 | Decisão consolidada | Criar | Design | Pendente |
| LINKS-007 | Auth e propriedade | Listar, gerir | Design | Pendente |
| LINKS-008 | Padrão HTTP existente | Todas | Design | Pendente |
| LINKS-009 | Decisão de produto | Resolver | Design | Pendente |
| LINKS-010 | URL Curta configurável | Criar | Design | Pendente |
| NFR-LINKS-001 | Segurança | Todas | Design | Pendente |
| NFR-LINKS-002 | Arquitetura existente | Todas | Design | Pendente |
| NFR-LINKS-003 | Concorrência | Criar, gerir | Design | Pendente |
| NFR-LINKS-004 | Matriz de testes | Todas | Tasks | Pendente |
| NFR-LINKS-005 | Regras de infraestrutura | Todas | Tasks | Pendente |

## Critérios de sucesso

- [x] Um Usuário autenticado consegue criar uma URL Curta válida ou recuperar a associação já existente para a mesma URL de Destino.
- [x] Nenhum Usuário consegue manter mais de dez Links Ativos, inclusive sob concorrência.
- [x] Um Usuário só consegue listar, desativar e reativar seus próprios Links.
- [x] Um visitante sem autenticação recebe `302` de uma URL Curta ativa e `404` para código inexistente ou desativado.
- [x] Todas as regras da feature possuem cobertura automatizada nos níveis unitário, integração ou E2E apropriados.
- [x] O gate completo do projeto é aprovado dentro do serviço Docker `api`.

## Resultado da execução

Implementação concluída nas tarefas T1–T10. A resolução pública usa middleware Express registrado em `configureApp` (`register-public-link-resolve.ts`) porque o `exclude: ':code'` do Nest também removia o prefixo de `GET /links`.
