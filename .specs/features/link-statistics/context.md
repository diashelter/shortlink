# Contexto: Estatísticas de Acesso dos Links

**Coletado em:** 14 de julho de 2026  
**SPEC:** `.specs/features/link-statistics/spec.md`  
**Status:** Aplicado ao design e à implementação validada

## Limite da feature

Esta feature adiciona coleta assíncrona e relatórios privados de acessos aos Links existentes. Não altera a criação, o ciclo de vida ou a resolução pública dos Links, nem entrega interface web.

## Decisões de produto

### O que é contabilizado

- Um Acesso é a emissão de um `302` pelo servidor para um Link Ativo; não confirma o carregamento do destino pelo navegador.
- Cada Acesso elegível compõe o total de acessos e pode gerar um Evento de Acesso assíncrono.
- Crawlers, previews e monitoramentos com assinatura conhecida não são contabilizados.
- Requisições sem user-agent são elegíveis, salvo outra assinatura automatizada reconhecida.
- Indisponibilidade de fila ou processamento nunca impede o `302`; o Acesso correspondente pode ficar ausente das estatísticas.

### Privacidade e retenção

- IP e user-agent existem apenas temporariamente na requisição e nunca são enviados para a fila, persistidos ou registrados em logs.
- O identificador pseudonimizado é limitado ao mesmo Link e dia UTC.
- O país é inferido localmente; falhas de inferência usam `Unknown`.
- Um Visitante Único Diário pertence ao primeiro país observado para seu pseudônimo no dia; mudanças posteriores não realocam esse único.
- Eventos e identificadores pseudonimizados temporários são removidos no fechamento do dia UTC às 01:00; jobs tardios são descartados.
- Agregados diários e mensais ficam disponíveis enquanto o Link existir, inclusive desativado.

### Métricas e relatório

- Com infraestrutura saudável, as métricas são consistentes de forma eventual e aparecem em até cinco minutos.
- O relatório é individual por Link e disponível exclusivamente ao proprietário autenticado.
- Exibe acessos totais, visitantes únicos diários, série diária e mensal densas, e países ordenados por acessos.
- O fuso é UTC.
- Sem período explícito, mostra as 30 datas UTC inclusivas entre hoje menos 29 dias e hoje; o intervalo customizado aceita até 12 meses-calendário inclusivos.
- O valor mensal de visitantes únicos é a soma dos únicos diários, não uma deduplicação de pessoas ao longo do mês.

## Ideias adiadas

- Dashboard e frontend.
- Relatório consolidado da Conta.
- Contador na listagem de Links.
- Referrer, dispositivo, navegador e sistema operacional.
- Localização mais precisa que país.
- Visitante único mensal real e rastreamento entre dias.
- Uso das métricas para faturamento, limites ou antifraude.
