# Progresso do projeto

Última atualização: 14 de julho de 2026

## Visão geral

O Shortlink é uma API NestJS para encurtamento de URLs com autenticação de usuários, PostgreSQL como fonte de verdade, Redis para estado distribuído e Docker Compose como ambiente obrigatório de desenvolvimento.

Os bounded contexts `Auth`, `Links` e `LinkStatistics` estão concluídos e validados. `Links` entrega criação idempotente, listagem, desativação, reativação e resolução pública de URLs Curtas. `LinkStatistics` coleta acessos elegíveis de forma assíncrona e expõe o Relatório de Link privado ao proprietário.

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
- Volume opcional `./data/geoip` para MMDB local de país (ausência resulta em `Unknown`).

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
- Cache-aside Redis versionado para resolução (`shortlink:links:resolution:v2:{shortCode}`) com `ResolvedLink = { linkId, destinationUrl }`; PostgreSQL permanece a fonte de verdade.
- Invalidação estrita de Redis antes de desativar/reativar; falha de Redis responde `503 LINK_CACHE_UNAVAILABLE` sem mutar o Link.
- Migration `CreateLinksTable` gerada pelo CLI TypeORM.

### Contexto `LinkStatistics`

- Coleta fire-and-forget após `302` elegível; bots conhecidos são excluídos; falha de fila não altera o redirecionamento.
- IP e user-agent existem só na derivação: HMAC diário por Link (`LINK_STATS_PSEUDONYM_SECRET`) e país via MMDB local ou `Unknown`.
- Fila BullMQ `link-statistics` com payload sanitizado (`eventId`, `linkId`, `occurredAt`, `occurredOn`, `country`, `visitorPseudonym`).
- Processamento e fechamento diário às 01:00 UTC exclusivamente no `queue-worker`.
- Agregados diários/mensais e distribuição por país em PostgreSQL; eventos e visitantes efêmeros removidos no fechamento do dia.
- Relatório autenticado `GET /api/v1/links/:linkId/statistics` com período UTC padrão de 30 dias e máximo de 12 meses-calendário.
- Migration `CreateLinkStatisticsTables` gerada pelo CLI TypeORM.

### Qualidade verificada

O gate completo após a feature `LinkStatistics` foi aprovado em 14 de julho de 2026:

- Lint e build aprovados.
- 127 testes unitários aprovados.
- 98 testes de integração aprovados.
- 51 testes E2E aprovados.

As evidências e o histórico de tarefas estão em:

- `.specs/features/authentication/`
- `.specs/features/links/`
- `.specs/features/link-statistics/`

## Documentação canônica

| Documento | Papel |
| --- | --- |
| `CONTEXT.md` | Glossário do domínio consolidado para identidade, autenticação, Links e estatísticas. |
| `docs/requisitos-autenticacao.md` | Regras funcionais da autenticação. |
| `docs/adr/0001-validacao-distribuida-de-sessoes.md` | Decisão de validação distribuída de sessões. |
| `.specs/features/authentication/spec.md` | Especificação implementada e validada da autenticação. |
| `.specs/features/authentication/design.md` | Desenho técnico da autenticação. |
| `.specs/features/authentication/tasks.md` | Histórico executado, gates e evidências da autenticação. |
| `.specs/features/links/spec.md` | Especificação implementada e validada de Links. |
| `.specs/features/links/design.md` | Desenho técnico de Links, incluindo SPEC_DEVIATION da resolução pública. |
| `.specs/features/links/tasks.md` | Histórico executado, gates e evidências de Links. |
| `.specs/features/links/context.md` | Decisões de produto capturadas para Links. |
| `.specs/features/link-statistics/spec.md` | Especificação implementada e validada de estatísticas de Link. |
| `.specs/features/link-statistics/design.md` | Desenho técnico da coleta, agregação e relatório. |
| `.specs/features/link-statistics/tasks.md` | Histórico executado, gates e evidências de estatísticas. |
| `.specs/features/link-statistics/context.md` | Decisões de produto capturadas para estatísticas. |
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

## Decisões de produto consolidadas em `LinkStatistics`

- Um Acesso é a emissão de `302` para um Link Ativo; crawlers/previews/monitores conhecidos não entram nas métricas.
- IP e user-agent nunca são persistidos, enfileirados ou logados; o país é inferido localmente ou vira `Unknown`.
- Visitantes únicos são diários por Link; o valor mensal é a soma dos únicos diários.
- Eventos e chaves pseudonimizadas são removidos às 01:00 UTC do dia seguinte; agregados permanecem enquanto o Link existir.
- O relatório é privado ao proprietário, usa UTC, padrão de 30 dias e máximo de 12 meses-calendário.
- Indisponibilidade de analytics não impede o `302`.

## Desvio técnico registrado

A resolução pública não usa `setGlobalPrefix(..., { exclude: [{ path: ':code' }] })`. Em NestJS 10, esse exclude também remove o prefixo de `GET /links` e quebra `/api/v1/links`. A implementação registra middleware Express antecipado em `register-public-link-resolve.ts`, documentado no design de Links.

## Ideias adiadas

- Alias personalizado escolhido pelo Usuário.
- Domínio próprio ou namespace por tenant.
- Dashboard ou frontend.
- Relatório consolidado da Conta.
- Contador na listagem de Links.
- Referrer, navegador, SO ou dispositivo.
- Localização mais precisa que país.
- Visitante único mensal real e rastreamento entre dias.
- Exclusão definitiva de Links.
- Edição da URL de Destino.
- Rate limit específico para Links.
- Uso de métricas para faturamento, limites ou antifraude.

## Próximos passos sugeridos

1. Abrir PR com as evidências do gate de `LinkStatistics`.
2. Escolher a próxima capacidade entre as ideias adiadas (alias, frontend ou relatório consolidado).
3. Manter `CONTEXT.md` e esta memória alinhados a qualquer decisão nova de produto.
