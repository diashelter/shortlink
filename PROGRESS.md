# Progresso do projeto

Última atualização: 14 de julho de 2026

## Visão geral

O Shortlink é uma API NestJS para encurtamento de URLs com autenticação de usuários, PostgreSQL como fonte de verdade, Redis para estado distribuído e Docker Compose como ambiente obrigatório de desenvolvimento.

Os bounded contexts `Auth` e `Links` estão concluídos e validados. `Links` entrega criação idempotente, listagem, desativação, reativação e resolução pública de URLs Curtas.

## Implementado

### Infraestrutura local

- Stack executada integralmente por Docker Compose.
- Serviços disponíveis: `api`, `nginx`, `postgres`, `redis`, `mailpit`, `queue-worker` e `tls-init`.
- Proxy HTTPS local com redirecionamento de HTTP para HTTPS.
- PostgreSQL e Redis não são publicados no host.
- Mailpit disponível para testar e-mails.
- TypeORM configurado com `synchronize` desabilitado.
- Migrations são geradas pelo CLI do TypeORM e executadas no container `api`.
- Harnesses de testes unitários, de integração e E2E configurados.

### Base HTTP e segurança transversal

- Prefixo global `/api/v1`.
- Validação global com rejeição de campos não permitidos.
- Envelope consistente de erros: `{ statusCode, code, message, errors? }`.
- CORS com allowlist obrigatória e suporte a credenciais.
- Limite de payload JSON, cookies e confiança em proxy configurados por ambiente.
- Resolução pública de Links registrada fora do prefixo `/api/v1` via middleware Express antecipado.

### Contexto `Auth`

- Cadastro de Conta Pendente e ativação por código enviado por e-mail.
- Login em duas etapas: e-mail/senha seguido de Código de Verificação.
- Access token JWT de 15 minutos, entregue no corpo da resposta.
- Refresh token opaco de sete dias em cookie `HttpOnly`, `Secure` e `SameSite=Lax`.
- Rotação de refresh token e detecção de reutilização.
- Sessão única por Usuário, com revogação imediata após logout, novo login e redefinição de senha.
- Recuperação e redefinição de senha por token opaco de uso único.
- Proteções contra enumeração de contas, força bruta, abuso de e-mail, CSRF e origens não confiáveis.
- Redis usado para estado efêmero, limites, bloqueios e cache distribuído de sessão; PostgreSQL permanece autoritativo.
- Auditoria sanitizada, sem senha, código ou token em dados persistidos.
- Worker BullMQ separado para envio assíncrono de e-mails.

### Contexto `Links`

- Criação autenticada de Link com URL de Destino canônica (HTTP/HTTPS absoluto, sem credenciais, até 2.048 caracteres).
- Código Encurtado de seis caracteres `A-Z0-9`, gerado com fonte criptograficamente segura e único globalmente.
- URL Curta composta exclusivamente por `PUBLIC_SHORT_URL_BASE/{code}`.
- Criação idempotente: retorna Link Ativo existente ou reativa Link Desativado do mesmo Usuário e destino.
- Limite de dez Links Ativos por Usuário, preservado sob concorrência via lock pessimista da conta.
- Listagem paginada (`page`, `limit`, filtro de estado) somente dos Links do proprietário.
- Desativação e reativação autenticadas, com isolamento entre Usuários (`403`/`404`).
- Resolução pública `GET /{code}` com redirecionamento `302`; códigos inválidos, inexistentes ou desativados retornam `404 LINK_NOT_FOUND`.
- Cache-aside Redis para resolução (`shortlink:links:resolution:{shortCode}`); PostgreSQL permanece a fonte de verdade.
- Invalidação estrita de Redis antes de desativar/reativar; falha de Redis responde `503 LINK_CACHE_UNAVAILABLE` sem mutar o Link.
- Migration `CreateLinksTable` gerada pelo CLI TypeORM.

### Qualidade verificada

O gate completo após a feature `Links` foi aprovado em 14 de julho de 2026:

- Lint e build aprovados.
- 100 testes unitários aprovados.
- 61 testes de integração aprovados.
- 34 testes E2E aprovados.

As evidências e o histórico de tarefas estão em:

- `.specs/features/authentication/`
- `.specs/features/links/`

## Documentação canônica

| Documento | Papel |
| --- | --- |
| `CONTEXT.md` | Glossário do domínio consolidado para identidade, autenticação e Links. |
| `docs/requisitos-autenticacao.md` | Regras funcionais da autenticação. |
| `docs/adr/0001-validacao-distribuida-de-sessoes.md` | Decisão de validação distribuída de sessões. |
| `.specs/features/authentication/spec.md` | Especificação implementada e validada da autenticação. |
| `.specs/features/authentication/design.md` | Desenho técnico da autenticação. |
| `.specs/features/authentication/tasks.md` | Histórico executado, gates e evidências da autenticação. |
| `.specs/features/links/spec.md` | Especificação implementada e validada de Links. |
| `.specs/features/links/design.md` | Desenho técnico de Links, incluindo SPEC_DEVIATION da resolução pública. |
| `.specs/features/links/tasks.md` | Histórico executado, gates e evidências de Links. |
| `.specs/features/links/context.md` | Decisões de produto capturadas para Links. |
| `API para encurtar links multitenant.md` | Documento histórico de produto; onde divergir, prevalecem SPEC e `CONTEXT.md`. |

## Decisões de produto consolidadas em `Links`

- A URL Curta usa o formato `{PUBLIC_SHORT_URL_BASE}/{code}`.
- O Código Encurtado é globalmente único, sem namespace de Usuário na URL pública.
- Um Usuário pode manter no máximo dez Links Ativos; desativar um Link libera uma posição.
- A resolução pública responde com redirecionamento HTTP temporário `302`.
- O Código Encurtado gerado automaticamente tem seis caracteres alfanuméricos em maiúsculas.
- A URL de Destino aceita somente endereços HTTP ou HTTPS absolutos, sem credenciais embutidas.
- A URL de Destino canônica aceita até 2.048 caracteres.
- A remoção de um Link ocorre por desativação reversível; um Link Desativado não redireciona e libera capacidade.
- Para uma URL de Destino já encurtada pelo mesmo Usuário, a criação retorna o Link Ativo existente e não consome outra posição.
- Para uma URL de Destino associada a um Link Desativado do mesmo Usuário, a criação reativa e retorna esse Link, preservando seu Código Encurtado.
- A igualdade de URL de Destino usa a serialização da URL API, preservando path, query string e fragmento.
- A listagem usa `page` a partir de 1 e `limit` entre 1 e 100, com padrão 20; exibe Links Ativos por padrão e permite incluir Links Desativados.
- A listagem ordena Links do mais recente para o mais antigo, com identificador público como desempate.
- A base pública da URL Curta é uma origem HTTPS sem caminho, query string ou fragmento.
- Desativação e reativação invalidam Redis antes da mutação e retornam `503` sem alterar o Link se Redis estiver indisponível.

## Desvio técnico registrado

A resolução pública não usa `setGlobalPrefix(..., { exclude: [{ path: ':code' }] })`. Em NestJS 10, esse exclude também remove o prefixo de `GET /links` e quebra `/api/v1/links`. A implementação registra middleware Express antecipado em `register-public-link-resolve.ts`, documentado no design de Links.

## Ideias adiadas

- Alias personalizado escolhido pelo Usuário.
- Domínio próprio ou namespace por tenant.
- Métricas, contagem de cliques e relatórios.
- Exclusão definitiva de Links.
- Edição da URL de Destino.
- Frontend ou dashboard.
- Rate limit específico para Links.

## Próximos passos sugeridos

1. Abrir PR da branch `feature/links` com as evidências do gate.
2. Escolher a próxima capacidade entre as ideias adiadas (métricas, alias ou frontend).
3. Manter `CONTEXT.md` e esta memória alinhados a qualquer decisão nova de produto.
