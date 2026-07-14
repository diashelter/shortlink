# SPEC: Autenticação com verificação por e-mail

## Status

- Fase: Execute (encerrada)
- Escopo: Grande
- Estado: Implementada — gate completo T22 aprovado (lint, build, unit 75, integration 43, e2e 29)
- Criada em: 2026-07-13
- Validada em: 2026-07-14

## Fontes canônicas

Esta SPEC consolida, nesta ordem de precedência:

1. `CONTEXT.md`
2. `docs/adr/0001-validacao-distribuida-de-sessoes.md`
3. `docs/requisitos-autenticacao.md`

O arquivo `API para encurtar links multitenant.md` é contexto histórico. Onde divergir desta SPEC — como em `/verify-code` versus endpoints separados de verificação — esta SPEC prevalece.

## Problema

A API precisa identificar Usuários de forma segura antes que possam criar e administrar seus Links. O projeto possui somente o scaffolding NestJS e a infraestrutura local pronta; ainda não há módulo de autenticação, persistência de identidade, integração com Redis, envio de e-mail ou proteção de rotas.

## Objetivos

- Permitir que um Usuário crie uma conta, verifique seu e-mail e conclua login com senha e código de seis dígitos.
- Emitir e renovar tokens sem armazenar credenciais no cliente além do cookie seguro de refresh token.
- Revogar imediatamente o acesso após logout, novo login ou redefinição de senha.
- Proteger os fluxos contra enumeração de contas, força bruta, CSRF, reutilização de token e vazamento de segredos.
- Operar em múltiplas instâncias de API sem estado local de autenticação.

## Fora de escopo

| Item | Motivo |
| --- | --- |
| Papéis além de `USER` | O produto inicial não possui administração nem autorização por papéis. |
| Login social, SSO e passkeys | São métodos de identidade independentes do fluxo e-mail/senha. |
| Aplicativo autenticador, SMS ou WebAuthn | A segunda etapa desta entrega é exclusivamente por e-mail. |
| Alteração de e-mail e senha autenticada | Fluxos de gestão de perfil não fazem parte desta feature. |
| Exclusão de conta | Requer regras de retenção e impacto nos Links que ainda não foram definidos. |
| Interface web de autenticação | Esta feature entrega a API; o frontend apenas consome seus contratos. |
| Produção de e-mails por provedor externo | O ambiente local usa Mailpit; a abstração do provedor será preparada para evolução futura. |
| Criar links e redirecionamentos | Pertencem ao domínio de Links e dependem da autenticação, mas não são implementados aqui. |

## Decisões de produto consolidadas

- Uma Conta nasce pendente e só fica ativa após verificar seu e-mail.
- Há somente o papel `USER`; ele acessa exclusivamente seus próprios Links.
- A senha é preservada exatamente como recebida, validada pela política de força e armazenada apenas como bcrypt com custo 12.
- O código de ativação ou login é numérico, possui seis dígitos, expira em uma hora, pode ser reenviado após 60 segundos e é invalidado por reenvio.
- Cinco falhas combinadas de senha e código bloqueiam o login por uma hora.
- O access token é um JWT de 15 minutos mantido somente em memória pelo cliente.
- O refresh token expira em sete dias e é entregue em cookie `HttpOnly`, `Secure` e `SameSite=Lax`.
- Uma conta mantém somente uma Sessão Ativa; novo login, logout e redefinição de senha revogam sessões e access tokens imediatamente.
- PostgreSQL é a fonte de verdade; Redis mantém apenas dados efêmeros e cache distribuído.
- O ambiente local DEVE disponibilizar uma origem HTTPS para testar o cookie de refresh com `Secure`; essa flag nunca é desabilitada. O proxy TLS expõe HTTP apenas para redirecionamento e não expõe a API diretamente.
- Cadastro e reenvio não revelam se um e-mail pertence a uma Conta Ativa: respondem genericamente e não emitem código de ativação para ela.
- Novo cadastro de uma Conta Pendente preserva sua senha e segue a regra de reenvio de ativação, inclusive o intervalo de 60 segundos.
- O intervalo de reenvio não cria um canal de enumeração: durante o cooldown, cadastro e reenvio retornam `202` genérico sem emitir código.
- Cada emissão assíncrona de código ou token possui um identificador versionado; apenas a emissão vigente pode gerar e enviar o segredo.
- `refresh` e `logout` exigem simultaneamente `X-CSRF-Token` válido e ao menos um `Origin` ou `Referer` permitido.
- Indisponibilidade do Redis em controles de abuso deve interromper endpoints sensíveis com `503`, sem liberar tentativas, e gerar evento observável.
- `POST /login` retorna um `challengeId` opaco; `POST /verify-login` recebe esse identificador e o código.
- Um Desafio de Login expira em uma hora, é de uso único e um novo login válido da mesma conta invalida o desafio anterior.
- As origens CORS permitidas são configuradas por allowlist obrigatória em variável de ambiente, incluindo a origem HTTPS local no desenvolvimento.

## Histórias de usuário

### P1: Cadastrar e ativar conta

**História**: Como visitante, quero cadastrar meu e-mail e senha e verificar meu e-mail para ativar minha conta.

**Por que P1**: Sem uma Conta Ativa não existe identidade autenticável na API.

**Critérios de aceite**:

1. QUANDO um visitante enviar e-mail válido, senha válida e confirmação correspondente para `POST /api/v1/auth/register`, ENTÃO o sistema DEVE criar uma Conta Pendente e solicitar o envio assíncrono de um Código de Verificação de ativação.
2. QUANDO o visitante enviar e-mail canônico e código de ativação válido para `POST /api/v1/auth/verify-email`, ENTÃO o sistema DEVE tornar a Conta Ativa e invalidar o código utilizado.
3. QUANDO o visitante reenviar a solicitação de código antes de 60 segundos, ENTÃO o sistema DEVE retornar `202` genérico sem criar um novo código.
4. QUANDO um novo código de ativação for emitido, ENTÃO o sistema DEVE invalidar o código anterior da mesma Conta e finalidade.
5. QUANDO a senha não atender à política definida, ENTÃO o sistema DEVE retornar `422` com erro por campo e não persistir a conta.
6. QUANDO o cadastro ou reenvio usar e-mail de uma Conta Ativa, ENTÃO o sistema DEVE responder genericamente sem emitir código de ativação.
7. QUANDO o cadastro usar e-mail de uma Conta Pendente, ENTÃO o sistema DEVE preservar a senha existente e aplicar a regra de reenvio de ativação.

**Teste independente**: cadastrar uma conta, obter o e-mail no Mailpit, verificar o código e confirmar que a conta passa a poder iniciar login.

### P1: Concluir login em duas etapas

**História**: Como Usuário com Conta Ativa, quero confirmar minha senha e o código enviado por e-mail para iniciar uma sessão segura.

**Por que P1**: É o caminho principal de acesso ao produto.

**Critérios de aceite**:

1. QUANDO um Usuário com Conta Ativa enviar credenciais válidas para `POST /api/v1/auth/login`, ENTÃO o sistema DEVE criar um Desafio de Login, retornar seu `challengeId` opaco e solicitar o envio assíncrono de um Código de Verificação de login.
2. QUANDO o Usuário enviar o `challengeId` e código válidos para `POST /api/v1/auth/verify-login`, ENTÃO o sistema DEVE revogar sessões existentes, criar uma nova Sessão Ativa e retornar um access token, sua expiração e um token CSRF.
3. QUANDO o login for concluído, ENTÃO o sistema DEVE configurar o refresh token somente em cookie `HttpOnly`, `Secure` e `SameSite=Lax`.
4. QUANDO credenciais inválidas forem enviadas, ENTÃO o sistema DEVE responder `401` com mensagem genérica sem revelar se o e-mail existe.
5. QUANDO uma Conta Pendente enviar senha válida, ENTÃO o sistema DEVE responder `403` com código `EMAIL_NOT_VERIFIED`.
6. QUANDO um novo Desafio de Login for criado para uma Conta, ENTÃO o desafio anterior deve ser invalidado; todo desafio expira em uma hora e só pode ser usado uma vez.

**Teste independente**: ativar uma conta, concluir login com código de e-mail e usar o access token em uma rota protegida de teste.

### P1: Renovar, encerrar e invalidar sessão

**História**: Como Usuário autenticado, quero renovar meu acesso e encerrar a sessão sabendo que tokens revogados deixam de funcionar imediatamente.

**Por que P1**: O modelo de access token curto e refresh token exige renovação; a revogação imediata é requisito de segurança explícito.

**Critérios de aceite**:

1. QUANDO `POST /api/v1/auth/refresh` receber refresh token e token CSRF válidos, ENTÃO o sistema DEVE validar a Sessão Ativa, rotacionar o refresh token e retornar novo access token.
2. QUANDO um refresh token já rotacionado for reutilizado, ENTÃO o sistema DEVE detectar a reutilização e revogar a sessão correspondente.
3. QUANDO `POST /api/v1/auth/logout` receber credenciais de sessão e proteção CSRF válidas, ENTÃO o sistema DEVE revogar a sessão no PostgreSQL, invalidar seu cache no Redis e remover o cookie de refresh token.
4. QUANDO uma rota protegida receber um JWT cujo `sessionId` esteja revogado, ENTÃO o sistema DEVE rejeitá-lo imediatamente, mesmo que seu tempo de expiração ainda não tenha sido alcançado.
5. QUANDO a chave da sessão não estiver no Redis ou Redis estiver indisponível, ENTÃO o sistema DEVE consultar PostgreSQL e tentar repopular o cache sem confiar em estado local da instância.

**Teste independente**: concluir login, confirmar uma rota protegida acessível, executar logout e confirmar que o mesmo access token é rejeitado imediatamente.

### P1: Recuperar senha com segurança

**História**: Como Usuário que perdeu a senha, quero solicitar um link de redefinição e definir uma nova senha sem expor a existência da minha conta.

**Por que P1**: Recuperação de acesso é essencial para uma conta baseada em senha.

**Critérios de aceite**:

1. QUANDO qualquer e-mail for enviado para `POST /api/v1/auth/forgot-password`, ENTÃO o sistema DEVE responder com sucesso genérico, independentemente de a conta existir.
2. QUANDO o e-mail pertencer a uma Conta Ativa, ENTÃO o sistema DEVE gerar Token de Redefinição opaco, aleatório, de uso único e válido por uma hora, persistindo somente seu hash.
3. QUANDO um novo reset for solicitado, ENTÃO o sistema DEVE invalidar todos os tokens de redefinição anteriores da conta.
4. QUANDO o token, a nova senha e sua confirmação forem válidos em `POST /api/v1/auth/reset-password`, ENTÃO o sistema DEVE alterar a senha, invalidar o token e revogar todas as sessões da conta.
5. QUANDO o e-mail de redefinição for emitido, ENTÃO o link DEVE transportar o token no fragmento (`#token=...`), e não na query string.

**Teste independente**: solicitar redefinição, capturar o link no Mailpit, redefinir a senha e confirmar que tokens emitidos antes da redefinição não funcionam.

### P1: Proteger autenticação contra abuso

**História**: Como responsável pela plataforma, quero limitar tentativas e requisições de autenticação para reduzir força bruta, abuso de e-mail e enumeração de contas.

**Por que P1**: Sem essas proteções, os fluxos de login e e-mail são vulneráveis desde a primeira entrega.

**Critérios de aceite**:

1. QUANDO senha ou Código de Verificação falharem cinco vezes para uma conta, ENTÃO o sistema DEVE criar Bloqueio Temporário de uma hora e responder `429` com `Retry-After: 3600`.
2. QUANDO `POST /api/v1/auth/login` exceder 10 requisições do mesmo IP e e-mail em 15 minutos, ENTÃO o sistema DEVE rejeitar novas tentativas no período.
3. QUANDO cadastro, reenvio de ativação ou recuperação exceder três requisições por e-mail por hora ou 10 por IP por hora, ENTÃO o sistema DEVE rejeitar novas tentativas no período.
4. QUANDO um código, desafio ou token de redefinição for inválido, expirado ou utilizado, ENTÃO o sistema DEVE usar resposta genérica sem revelar a causa.
5. QUANDO um código ou token for persistido em Redis ou PostgreSQL, ENTÃO o sistema DEVE persistir apenas hash ou HMAC apropriado, nunca seu valor em texto puro.
6. QUANDO Redis estiver indisponível durante a avaliação de rate limit, bloqueio ou intervalo de reenvio, ENTÃO o sistema DEVE responder `503` sem executar o fluxo e registrar um evento observável.

**Teste independente**: exceder cada limite e confirmar a resposta bloqueada, o TTL esperado e a ausência de credenciais em logs.

### P1: Aplicar segurança de transporte e requisição

**História**: Como Usuário, quero que requisições baseadas em cookie sejam protegidas contra origens não confiáveis e CSRF.

**Por que P1**: O refresh token está em cookie e requer defesa explícita contra requisições forjadas.

**Critérios de aceite**:

1. QUANDO a API receber requisição em ambiente que não usa HTTPS, ENTÃO a configuração de produção DEVE rejeitar ou redirecionar conforme a infraestrutura de borda definida; o ambiente local DEVE disponibilizar HTTPS para validar o cookie `Secure`.
2. QUANDO uma origem não permitida tentar usar uma rota com credenciais, ENTÃO o CORS DEVE rejeitar a requisição; origens permitidas DEVEM vir de allowlist configurada por variável de ambiente e origem curinga não pode ser configurada com credenciais.
3. QUANDO `POST /api/v1/auth/refresh` ou `POST /api/v1/auth/logout` não contiver `X-CSRF-Token` válido ou não tiver ao menos um entre `Origin` e `Referer` permitido, ENTÃO o sistema DEVE rejeitar a operação.
4. QUANDO a sessão for criada, ENTÃO o sistema DEVE associar um token CSRF à sessão e retornar seu valor somente no corpo da resposta de conclusão do login.

**Teste independente**: executar refresh válido e repetir a chamada com origem ou token CSRF inválido, confirmando que apenas a chamada válida é aceita.

## Requisitos funcionais

### AUTH-001: Estrutura modular de autenticação

A implementação DEVE criar um módulo de autenticação independente, com controllers finos, serviços de regra de negócio e repositórios de persistência explícitos.

### AUTH-002: Modelo de identidade

A implementação DEVE persistir Usuários com UUID público, e-mail canônico único, estado de conta, papel `USER`, hash bcrypt de senha e timestamps.

### AUTH-003: Verificação por e-mail

A implementação DEVE diferenciar códigos de ativação de códigos de login por finalidade, associá-los a uma conta e aplicar expiração, uso único e reenvio.

### AUTH-004: Sessão e refresh token

A implementação DEVE persistir sessões com `sessionId` UUID v4, hash de refresh token, hash de token CSRF, expiração, rotação e revogação.

### AUTH-005: JWT com revogação imediata

Todo JWT de access token DEVE conter o identificador da conta, o papel, o `sessionId` e expiração de 15 minutos; guards de rotas protegidas DEVEM validar a sessão ativa.

### AUTH-006: Cache e estado distribuído

Redis DEVE manter códigos, limites, bloqueios e cache de sessões; PostgreSQL DEVE permanecer a fonte de verdade para entidades duráveis e revogações.

### AUTH-007: Redefinição de senha

A implementação DEVE suportar criação, validação e invalidação de Tokens de Redefinição sem persistir seu valor original.

### AUTH-008: E-mail assíncrono

A implementação DEVE encapsular o provedor de e-mail e enfileirar mensagens de ativação, login e redefinição com política de tentativas configurável.

### AUTH-009: Contrato HTTP

Os endpoints de autenticação DEVEM ser publicados sob `/api/v1/auth`, validar entradas e retornar `422`, `401`, `403`, `429` e `503` conforme o contrato consolidado. Todos os erros DEVEM usar `{ statusCode, code, message, errors? }`; `errors` contém mensagens por campo exclusivamente para `422`.

| Método e rota | Corpo de requisição | Resposta de sucesso |
| --- | --- | --- |
| `POST /register` | `email`, `password`, `passwordConfirmation` | `202` com resposta genérica |
| `POST /verify-email` | `email`, `code` | `204` |
| `POST /resend-email-verification` | `email` | `202` com resposta genérica |
| `POST /login` | `email`, `password` | `202` com `challengeId` e expiração |
| `POST /verify-login` | `challengeId`, `code` | `200` com `accessToken`, `expiresIn`, `csrfToken` e cookie de refresh |
| `POST /refresh` | Sem corpo; cookie de refresh e cabeçalho `X-CSRF-Token` | `200` com `accessToken` e `expiresIn`, além do cookie de refresh rotacionado |
| `POST /logout` | Sem corpo; cookie de refresh e cabeçalho `X-CSRF-Token` | `204` e remoção do cookie |
| `POST /forgot-password` | `email` | `202` com resposta genérica |
| `POST /reset-password` | `token`, `password`, `passwordConfirmation` | `204` |

### AUTH-010: Auditoria segura

A implementação DEVE registrar eventos de criação e revogação de sessão, bloqueio e redefinição sem registrar senhas, códigos ou tokens.

## Requisitos não funcionais

### NFR-AUTH-001: Sem estado local

Nenhuma instância da API pode depender de memória local para validar sessão, código, bloqueio, limite ou token.

### NFR-AUTH-002: Segurança de segredos

Credenciais e tokens devem ser protegidos em trânsito por HTTPS, armazenados apenas como hash quando persistidos e excluídos de logs e eventos de auditoria.

### NFR-AUTH-003: Consistência de revogação

A revogação de sessão deve ser confirmada no PostgreSQL antes de a sessão ser considerada inválida e deve invalidar o cache Redis associado.

### NFR-AUTH-004: Testabilidade

Cada regra funcional deve possuir testes automatizados unitários ou de integração; os fluxos públicos e protegidos críticos devem possuir testes end-to-end.

### NFR-AUTH-005: Operação em Docker

Build, lint e testes devem executar pelo serviço `api` do Docker Compose. PostgreSQL, Redis e Mailpit existentes são dependências obrigatórias da feature.

## Casos de borda

- QUANDO a conta não existir ou estiver pendente em recuperação de senha, ENTÃO a resposta deve permanecer genérica.
- QUANDO a conta estiver bloqueada, ENTÃO senha e código corretos não devem concluir login até o bloqueio expirar.
- QUANDO dois logins forem concluídos quase simultaneamente, ENTÃO apenas a última Sessão Ativa pode permanecer válida.
- QUANDO o refresh token for usado ao mesmo tempo em duas requisições, ENTÃO somente uma rotação pode vencer; a outra deve ser tratada como reutilização.
- QUANDO o Redis estiver indisponível, ENTÃO a consulta ao PostgreSQL deve preservar a decisão de sessão ativa ou revogada; endpoints que dependem de rate limiting, bloqueio ou intervalo de reenvio devem responder `503` de forma observável.
- QUANDO uma sessão expirar, ENTÃO seu JWT e refresh token não devem ser renovados, mesmo que ainda existam chaves expiradas em cache.
- QUANDO uma redefinição de senha for concluída, ENTÃO qualquer access token anterior deve falhar na próxima requisição protegida.
- QUANDO uma requisição contiver campos extras, valores malformados ou payloads excessivos, ENTÃO a validação deve rejeitá-la sem executar efeitos de domínio.

## Rastreabilidade de requisitos

| ID | Origem | História | Próxima fase | Estado |
| --- | --- | --- | --- | --- |
| AUTH-001 | Estrutura modular | Todas | — | Implementado (T14–T22; gate completo) |
| AUTH-002 | Conta e papel | Cadastro | — | Implementado (T7–T9, T16; e2e) |
| AUTH-003 | Código e ativação | Cadastro, Login | — | Implementado (T12, T15–T18; e2e) |
| AUTH-004 | Sessões e tokens | Sessão | — | Implementado (T9–T10, T13, T18–T19; e2e) |
| AUTH-005 | ADR-0001 | Sessão | — | Implementado (T13, T18–T19; unit+integration+e2e) |
| AUTH-006 | Cache distribuído | Sessão, Proteção | — | Implementado (T12–T13, T21; integration+e2e) |
| AUTH-007 | Redefinição | Recuperar senha | — | Implementado (T9, T15, T20; e2e) |
| AUTH-008 | E-mail assíncrono | Cadastro, Login, Reset | — | Implementado (T15–T18, T20; integration+e2e) |
| AUTH-009 | Contrato HTTP | Todas | — | Implementado (T3, T14–T21; e2e) |
| AUTH-010 | Auditoria | Proteção | — | Implementado (T11, T18, T20–T21; integration+e2e) |
| NFR-AUTH-001 | Escalabilidade | Sessão | — | Implementado (T6, T12–T13, T21; integration) |
| NFR-AUTH-002 | Segurança | Todas | — | Implementado (T3, T8, T11, T21; unit+e2e) |
| NFR-AUTH-003 | ADR-0001 | Sessão | — | Implementado (T10, T13, T19; integration+e2e) |
| NFR-AUTH-004 | Qualidade | Todas | — | Implementado (T2, T22; gate completo) |
| NFR-AUTH-005 | Docker | Todas | — | Implementado (T4–T5, T22; Compose + gate via `api`) |

## Critérios de sucesso

Evidência do gate T22 (2026-07-14): lint OK · build OK · unit 11/75 · integration 9/43 · e2e 2/29.

- [x] Um Usuário consegue percorrer cadastro, ativação, login, renovação, logout e redefinição de senha por meio da API. *(e2e auth: register→verify→login→refresh→logout→forgot/reset)*
- [x] Access tokens revogados deixam de autorizar rotas protegidas imediatamente. *(e2e refresh/logout e reset; AUTH-005)*
- [x] Códigos, tokens, limites e bloqueios obedecem aos TTLs e regras definidos. *(integration Redis/abuse + e2e T21)*
- [x] As respostas de erro não expõem a existência de contas ou a causa específica de falha de códigos e tokens. *(e2e anti-enumeração e erros genéricos)*
- [x] Testes automatizados comprovam todos os critérios de aceite P1. *(suíte unit+integration+e2e no gate completo)*

## Pronto para próximas fases

A feature de autenticação está implementada e validada pelo gate completo. Próximos trabalhos de produto (Links, frontend de auth, etc.) devem partir desta base sem reabrir AUTH-001–AUTH-010 salvo mudança de requisito.
