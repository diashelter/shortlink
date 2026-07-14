# SPEC: Estatísticas de Acesso dos Links

## Status

- Fase: Execute (concluída)
- Escopo: Grande
- Estado: Implementada e validada — gate completo aprovado em 14 de julho de 2026
- Criada em: 14 de julho de 2026

## Fontes canônicas

Esta SPEC consolida, nesta ordem de precedência:

1. `CONTEXT.md`
2. Esta SPEC
3. `.specs/features/links/spec.md`
4. `PROGRESS.md`

As decisões desta SPEC substituem o item "Métricas, cliques, relatórios e analytics" anteriormente declarado fora de escopo pela feature `Links`, sem alterar as regras de criação, gestão e resolução já implementadas.

## Problema

Os Links já redirecionam visitantes e podem ser gerenciados por seus proprietários, mas o Usuário não consegue saber se foram acessados nem observar a evolução desses acessos. O sistema precisa contabilizar os redirecionamentos públicos e disponibilizar estatísticas úteis ao proprietário, sem colocar IP ou user-agent brutos em persistência e sem prejudicar a disponibilidade ou a latência da URL Curta.

## Objetivos

- Registrar estatísticas de redirecionamentos HTTP `302` emitidos para Links Ativos.
- Exibir ao proprietário um Relatório de Link com acessos, visitantes únicos diários e distribuição por país.
- Preservar a resolução pública mesmo quando a fila ou o processamento de estatísticas estiver indisponível.
- Processar eventos de forma assíncrona e tornar dados novos visíveis em até cinco minutos com infraestrutura saudável.
- Minimizar dados de visitantes: nunca persistir IP nem user-agent brutos.

## Fora de escopo

| Item | Motivo |
| --- | --- |
| Dashboard ou frontend | A entrega continua exclusivamente na API. |
| Relatório consolidado da Conta | O relatório inicial é individual por Link. |
| Exibir contador na listagem de Links | A consulta inicial é o Relatório de Link detalhado. |
| Referrer, navegador, sistema operacional ou tipo de dispositivo | Não foram selecionados como métricas da primeira versão. |
| Localização precisa (cidade, coordenadas) | O único dado geográfico persistido é o país. |
| Visitante único mensal real | O identificador pseudonimizado expira diariamente; o valor mensal é a soma dos únicos diários. |
| Rastreamento entre Links ou dias | Não é compatível com a pseudonimização diária escolhida. |
| Garantia de entrega ou reconciliação de evento perdido | Métricas são best-effort e não podem degradar o redirecionamento. |
| Cobrança, limite de uso ou antifraude baseado em cliques | Contagem estatística não é mecanismo de autorização ou faturamento. |

## Decisões de produto consolidadas

- Um **Acesso** é a emissão bem-sucedida de `302` pelo servidor para um Link Ativo; não significa que o navegador chegou ou carregou a URL de Destino.
- Cada Acesso elegível incrementa o total de acessos e origina um Evento de Acesso processado em fila.
- O processamento é eventual: novas estatísticas podem aparecer alguns minutos após o redirecionamento.
- Quando a infraestrutura de estatísticas está saudável, um Acesso elegível DEVE estar visível no relatório em até cinco minutos.
- Se a fila ou o processamento de estatísticas falhar, a URL Curta continua respondendo `302`; esse Acesso pode não ser contabilizado.
- Crawlers, previews de redes sociais e monitoramentos reconhecidos por lista estática versionada de assinaturas de user-agent não entram nas estatísticas; a lista inicial cobre Google, Bing, Facebook, Twitter/X, Slack, Discord, LinkedIn e monitores de uptime.
- Requisição sem user-agent permanece elegível, salvo identificação automatizada por outra assinatura disponível.
- IP e user-agent são usados apenas durante o tratamento da requisição para derivar informações. Seus valores brutos não podem ser colocados no banco, na fila, no cache, em logs ou mensagens de erro gerados pela aplicação.
- O Identificador de Visitante Pseudonimizado permite deduplicação somente por Link e por dia UTC.
- O país é inferido localmente a partir do IP temporário. Se não houver inferência possível, o agrupamento é `Unknown`.
- Eventos de Acesso e identificadores pseudonimizados temporários são excluídos no fechamento de seu dia UTC às 01:00; jobs recebidos após o fechamento são descartados. Agregados diários e mensais permanecem enquanto o Link existir, inclusive desativado.
- O Relatório de Link é privado ao seu Usuário proprietário, usa UTC, assume as 30 datas inclusivas entre hoje menos 29 dias e hoje quando não houver período e aceita intervalo customizado de até 12 meses-calendário inclusivos.
- Visitantes únicos mensais representam a soma de Visitantes Únicos Diários; o mesmo visitante em dias distintos pode ser contado mais de uma vez.
- Um Visitante Único Diário é atribuído ao primeiro País de Acesso observado para seu pseudônimo naquele dia.

## Histórias de usuário

### P1: Registrar acessos sem afetar a URL Curta

**História:** Como proprietário de um Link, quero que redirecionamentos públicos elegíveis sejam contabilizados, para que eu tenha dados de uso sem tornar a URL Curta menos disponível.

**Por que P1:** A coleta confiável e não intrusiva é a base de qualquer estatística exibida.

**Critérios de aceite:**

1. QUANDO um visitante acessar `GET /{code}` de um Link Ativo com código válido, ENTÃO o sistema DEVE continuar respondendo `302` com a URL de Destino validada.
2. QUANDO esse `302` for emitido e o tráfego não for identificado como automatizado conhecido, ENTÃO o sistema DEVE iniciar de forma assíncrona a coleta de um Evento de Acesso.
3. QUANDO o código for inválido, inexistente ou de Link Desativado, ENTÃO o sistema DEVE retornar `404 LINK_NOT_FOUND` e NÃO DEVE contabilizar acesso.
4. QUANDO a fila ou o processador de estatísticas estiver indisponível, ENTÃO o redirecionamento elegível DEVE continuar retornando `302`, sem aguardar recuperação e sem retornar erro de analytics ao visitante.
5. QUANDO um crawler, preview ou monitoramento for identificado por uma assinatura conhecida, ENTÃO o sistema DEVE redirecionar normalmente, mas NÃO DEVE criar Evento de Acesso nem incrementar agregados.
6. QUANDO a coleta assíncrona não puder ser iniciada ou processada, ENTÃO o sistema DEVE registrar uma falha sanitizada para operação, sem conter IP, user-agent ou URL de Destino.

**Teste independente:** acessar uma URL Curta ativa sem autenticação, confirmar `302` e, após o processamento assíncrono, confirmar que o Relatório de Link mostra um acesso; interromper a infraestrutura de estatísticas e confirmar que o mesmo `302` permanece disponível.

### P1: Proteger e minimizar os dados de visitante

**História:** Como visitante, quero que a plataforma gere estatísticas sem reter meus identificadores brutos, para reduzir a exposição dos meus dados.

**Por que P1:** IP e user-agent podem ser dados pessoais ou aumentar a capacidade de identificação quando combinados.

**Critérios de aceite:**

1. QUANDO um Acesso elegível for coletado, ENTÃO IP e user-agent DEVEM existir apenas durante a derivação de dados e ser descartados antes do enfileiramento e da persistência.
2. O Evento de Acesso DEVE conter somente os atributos necessários para agregação: referência ao Link, instante UTC, Identificador de Visitante Pseudonimizado diário e País de Acesso ou `Unknown`.
3. QUANDO dois Acessos do mesmo visitante ocorrerem no mesmo Link e no mesmo dia UTC, ENTÃO eles DEVEM contribuir com dois acessos totais e apenas um Visitante Único Diário.
4. QUANDO o mesmo visitante acessar o mesmo Link em dias UTC diferentes, ENTÃO cada dia DEVE poder contabilizá-lo como Visitante Único Diário.
5. QUANDO o país não puder ser inferido localmente, ENTÃO o Acesso DEVE ser agregado em `Unknown`, preservando o total.
6. QUANDO a agregação diária for concluída, ENTÃO os Eventos de Acesso incluídos nela DEVEM ser eliminados.

**Teste independente:** processar acessos repetidos e em dias distintos, inspecionar a persistência e os payloads da fila para confirmar a ausência de IP/user-agent brutos, os únicos diários esperados e a remoção dos eventos após agregação.

### P1: Consultar relatório de um Link próprio

**História:** Como Usuário autenticado, quero consultar as estatísticas de cada Link que criei, para avaliar seus acessos e países de origem.

**Por que P1:** Dados coletados não entregam valor sem uma consulta autorizada e compreensível.

**Critérios de aceite:**

1. QUANDO o proprietário chamar `GET /api/v1/links/{linkId}/statistics` sem período, ENTÃO o sistema DEVE retornar o Relatório de Link das 30 datas UTC inclusivas entre o dia corrente menos 29 dias e o dia corrente.
2. QUANDO o proprietário informar `from` e `to` válidos, ENTÃO o sistema DEVE retornar o intervalo UTC inclusivo solicitado, desde que tenha no máximo 12 meses-calendário.
3. QUANDO o período for inválido, `from` for posterior a `to`, ou exceder 12 meses, ENTÃO o sistema DEVE retornar `422 VALIDATION_ERROR`.
4. O relatório DEVE conter o total de acessos, Visitantes Únicos Diários somados no período, série diária e mensal densas em ordem cronológica crescente e distribuição por País de Acesso em ordem decrescente de acessos, com desempate pelo código do país.
5. O valor mensal de visitantes únicos DEVE ser a soma dos Visitantes Únicos Diários daquele mês, e sua semântica DEVE ficar explícita no contrato da API.
6. QUANDO o Link não possuir acessos no período, ENTÃO o relatório DEVE retornar totais zero, todos os períodos solicitados explicitamente zerados nas séries e `countries` vazio, sem erro.
7. QUANDO o Link pertencer a outro Usuário, ENTÃO o sistema DEVE retornar `403 FORBIDDEN`.
8. QUANDO o Link não existir, ENTÃO o sistema DEVE retornar `404 LINK_NOT_FOUND`.
9. QUANDO o Link estiver Desativado, ENTÃO seu proprietário DEVE continuar podendo consultar os agregados históricos.

**Teste independente:** criar Links para dois Usuários, gerar acessos para um deles, aguardar o processamento e confirmar que somente o proprietário vê seus totais, séries e países no intervalo esperado.

## Requisitos funcionais

### LINK-STATS-001: Estrutura modular

A implementação DEVE introduzir um módulo de estatísticas de Link independente, com interfaces do próprio contexto para coleta, processamento, agregação e consulta. Controllers e o middleware público devem permanecer finos; TypeORM, BullMQ e geolocalização devem permanecer em implementações externas conectadas pelo módulo NestJS.

### LINK-STATS-002: Coleta pública assíncrona

A resolução pública existente DEVE iniciar a coleta assíncrona somente após resolver um Link Ativo elegível para `302`. A coleta não pode ser aguardada nem alterar o contrato atual de `302`, `404 LINK_NOT_FOUND`, cache-aside ou autenticação pública.

### LINK-STATS-003: Filtragem de tráfego automatizado

O sistema DEVE manter um critério explícito e testável para reconhecer assinaturas conhecidas de crawler, preview e monitoramento pelo user-agent temporário. Tráfego reconhecido não pode produzir Evento de Acesso nem alterar agregados; tráfego não reconhecido permanece elegível.

### LINK-STATS-004: Pseudonimização e privacidade

O sistema DEVE derivar um Identificador de Visitante Pseudonimizado com escopo de Link e dia UTC a partir dos dados temporários da requisição. IP e user-agent brutos não podem ser persistidos, enfileirados, enviados a serviço externo, incluídos em cache, logs ou respostas. A inferência de País de Acesso deve ocorrer localmente; o resultado é um país ou `Unknown`.

### LINK-STATS-005: Eventos e agregados

Um Evento de Acesso DEVE representar somente um Acesso elegível e conter exclusivamente informações derivadas necessárias à agregação. O processamento deve gerar Agregados de Acessos diários e mensais em UTC por Link e país, com total de acessos e Visitantes Únicos Diários. O contador total exposto pelo Relatório deve ser proveniente desses agregados persistidos no PostgreSQL.

### LINK-STATS-006: Retenção

Eventos de Acesso DEVEM ser removidos após contribuírem para a agregação diária. Agregados diários e mensais DEVEM ser preservados enquanto o Link existir, inclusive em estado Desativado. A remoção futura de um Link deve respeitar a política de deleção aplicável à relação de dados.

### LINK-STATS-007: Relatório autenticado

O endpoint `GET /api/v1/links/{linkId}/statistics` DEVE exigir `AuthSessionGuard` e aceitar o UUID público de gestão do Link. Somente o proprietário pode consultar o relatório. A resposta de sucesso DEVE ser JSON direto, consistente com as rotas de Links existentes, e incluir:

```json
{
  "linkId": "uuid",
  "period": {
    "from": "2026-06-15",
    "to": "2026-07-14",
    "timezone": "UTC"
  },
  "totals": {
    "accesses": 0,
    "dailyUniqueVisitors": 0
  },
  "daily": [],
  "monthly": [],
  "countries": []
}
```

Cada item de `daily` DEVE ter `{ date: "YYYY-MM-DD", accesses, dailyUniqueVisitors }`; cada item de `monthly`, `{ month: "YYYY-MM", accesses, dailyUniqueVisitors }`; e cada item de `countries`, `{ country, accesses, dailyUniqueVisitors }`. Séries são densas e ordenadas cronologicamente; país indisponível DEVE usar `Unknown`.

### LINK-STATS-008: Períodos em UTC

O relatório DEVE usar datas de calendário UTC. Sem `from` e `to`, deve consultar a data UTC corrente e as 29 anteriores. Com período explícito, deve exigir ambas as datas e limitar o intervalo a no máximo 12 meses-calendário inclusivos. A série mensal deve usar meses UTC completos ou parciais quando o intervalo solicitado os interceptar.

### LINK-STATS-009: Disponibilidade e consistência eventual

A fila e o processamento de estatísticas são best-effort: indisponibilidade, falha de enqueue ou falha de processamento não podem impedir um `302` já elegível. PostgreSQL é a fonte de verdade de Eventos e Agregados persistidos; Redis pode suportar a fila ou otimizações, mas não pode ser a única fonte de dados do relatório.

### LINK-STATS-010: Compatibilidade com Links

A feature não deve alterar os contratos atuais de criação, listagem, desativação, reativação, resolução, limite de dez Links Ativos, Código Encurtado nem URL de Destino. Link Desativado não recebe novos acessos, mas mantém seus agregados consultáveis pelo proprietário.

## Requisitos não funcionais

### NFR-LINK-STATS-001: Desempenho da resolução

A preparação e o disparo da coleta não devem adicionar espera pelo processamento de analytics à resposta pública. O caminho crítico de `GET /{code}` deve continuar priorizando a resolução e a emissão do `302`.

### NFR-LINK-STATS-002: Segurança e isolamento

O Relatório de Link deve respeitar integralmente a propriedade já existente. Dados de visitante não podem vazar pela API, logs, filas ou persistência. O relatório não é público e não pode ser obtido pelo Código Encurtado.

### NFR-LINK-STATS-003: Privacidade e minimização

A implementação deve limitar a persistência a dados derivados necessários para as métricas selecionadas. O país deve ser calculado sem transferir IP a serviço externo, e eventos pseudonimizados devem ter a retenção curta definida nesta SPEC. A responsabilidade desta feature cobre a aplicação, suas filas, caches e logs; logs de proxy e observabilidade de infraestrutura exigem configuração operacional própria.

### NFR-LINK-STATS-004: Confiabilidade de agregação

O processamento concorrente de Eventos de Acesso deve preservar corretamente totais e visitantes únicos diários, sem duplicar um Evento de Acesso processado novamente. A agregação e a limpeza devem ser idempotentes ou possuir garantia equivalente.

### NFR-LINK-STATS-005: Observabilidade sanitizada

Falhas de enfileiramento, processamento, geolocalização e agregação devem ser registradas com contexto operacional suficiente para diagnóstico, mas sem IP, user-agent, URL de Destino ou Identificador de Visitante Pseudonimizado.

### NFR-LINK-STATS-006: Testabilidade e Docker

Cada regra deve possuir cobertura unitária, de integração ou E2E apropriada. Migrations devem ser geradas pelo CLI TypeORM, nunca escritas manualmente. Build, lint, migrations e testes devem executar pelo serviço Docker Compose `api`; cenários assíncronos devem ter sincronização determinística, sem esperas arbitrárias.

## Casos de borda

- QUANDO um Link for desativado após a resolução e antes do processamento assíncrono, ENTÃO o Evento já elegível pode ser agregado, pois representa um `302` emitido quando o Link estava Ativo; acessos posteriores não são criados.
- QUANDO o mesmo visitante produzir múltiplos acessos no mesmo Link durante o mesmo dia UTC, ENTÃO todos incrementam acessos totais, mas apenas um incrementa Visitantes Únicos Diários.
- QUANDO um visitante acessar dois Links distintos no mesmo dia UTC, ENTÃO cada Link pode contabilizá-lo como Visitante Único Diário próprio.
- QUANDO a identificação do cliente depender de proxy confiável, ENTÃO a derivação deve respeitar a configuração existente de confiança em proxy; a ausência de IP utilizável não pode impedir o redirecionamento e deve resultar em país `Unknown`.
- QUANDO uma tentativa de fila falhar, ENTÃO o redirecionamento permanece bem-sucedido e o relatório pode não refletir aquele acesso.
- QUANDO um Evento for entregue mais de uma vez ao consumidor, ENTÃO os agregados não podem ser incrementados duplicadamente.
- QUANDO o período solicitado atravessar meses, ENTÃO a resposta deve separar cada mês UTC interceptado e manter a semântica de soma dos únicos diários.
- QUANDO a consulta de um período incluir o dia UTC atual, ENTÃO seus dados podem estar incompletos até cinco minutos após cada Acesso elegível, quando a infraestrutura estiver saudável.
- QUANDO um país previamente inferido não estiver disponível em determinado acesso, ENTÃO somente aquele acesso entra em `Unknown`; os demais agrupamentos não são alterados.

## Rastreabilidade de requisitos

| ID | Origem | História | Próxima fase | Estado |
| --- | --- | --- | --- | --- |
| LINK-STATS-001 | Convenções modulares | Todas | — | ✅ Done |
| LINK-STATS-002 | Decisão de baixa latência | Registrar acessos | — | ✅ Done |
| LINK-STATS-003 | Decisão de produto | Registrar acessos | — | ✅ Done |
| LINK-STATS-004 | `CONTEXT.md` | Proteger dados | — | ✅ Done |
| LINK-STATS-005 | `CONTEXT.md` | Registrar, consultar | — | ✅ Done |
| LINK-STATS-006 | Decisão de retenção | Proteger dados | — | ✅ Done |
| LINK-STATS-007 | Decisão de consulta | Consultar relatório | — | ✅ Done |
| LINK-STATS-008 | Decisão de fuso e período | Consultar relatório | — | ✅ Done |
| LINK-STATS-009 | Decisão de disponibilidade | Registrar acessos | — | ✅ Done |
| LINK-STATS-010 | SPEC de Links | Todas | — | ✅ Done |
| NFR-LINK-STATS-001 | Decisão de baixa latência | Registrar acessos | — | ✅ Done |
| NFR-LINK-STATS-002 | Auth e propriedade | Consultar relatório | — | ✅ Done |
| NFR-LINK-STATS-003 | Minimização de dados | Proteger dados | — | ✅ Done |
| NFR-LINK-STATS-004 | Consistência concorrente | Registrar, consultar | — | ✅ Done |
| NFR-LINK-STATS-005 | Observabilidade | Registrar acessos | — | ✅ Done |
| NFR-LINK-STATS-006 | Regras de infraestrutura | Todas | — | ✅ Done |

## Critérios de sucesso

- [x] Um `302` de Link Ativo elegível é refletido no Relatório de Link em até cinco minutos quando a infraestrutura de estatísticas está saudável.
- [x] Falha de analytics não impede nem altera o `302` público.
- [x] Nenhum IP ou user-agent bruto é persistido, enfileirado, registrado ou retornado.
- [x] Usuários veem apenas relatórios de seus próprios Links.
- [x] Totais, únicos diários, meses e países respeitam UTC e a semântica de pseudonimização diária.
- [x] Eventos são removidos após agregação diária, e Links Desativados mantêm seus agregados consultáveis.
- [x] Todos os comportamentos têm cobertura automatizada e os gates executam no Docker.

## Evidências do gate completo

Executado em 14 de julho de 2026 dentro do serviço `api`:

- Lint e build aprovados.
- 127 testes unitários aprovados.
- 98 testes de integração aprovados.
- 51 testes E2E aprovados.
