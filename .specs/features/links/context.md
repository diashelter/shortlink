# Contexto: Links

**Coletado em:** 14 de julho de 2026  
**SPEC:** `.specs/features/links/spec.md`  
**Status:** Aplicado ao design

## Limite da feature

Esta feature entrega o contexto `Links`: criação idempotente, listagem paginada, desativação, reativação e resolução pública de URLs Curtas para Usuários autenticados. Não inclui aliases personalizados, métricas de acesso, domínios próprios ou gestão de contas.

## Decisões de produto

### Identificação pública

- A URL Curta segue o formato `https://dominio/{code}`.
- O Código Encurtado é globalmente único.
- O Código Encurtado gerado automaticamente contém seis caracteres alfanuméricos em maiúsculas.
- A resolução pública redireciona temporariamente com HTTP `302`.

### URL de Destino e duplicidade

- A URL de Destino aceita somente URLs absolutas HTTP ou HTTPS sem credenciais embutidas.
- A URL de Destino canônica aceita até 2.048 caracteres.
- A igualdade da URL de Destino usa sua serialização pela URL API: esquema e host são normalizados, portas padrão são removidas e path, query string e fragmento são preservados.
- Uma criação para URL de Destino que já possui Link Ativo do mesmo Usuário retorna o Link existente, sem consumir outra posição.
- Uma criação para URL de Destino vinculada a Link Desativado do mesmo Usuário reativa e retorna esse Link, preservando o Código Encurtado.

### Ciclo de vida e capacidade

- Cada Usuário pode manter no máximo dez Links Ativos.
- A desativação é reversível, interrompe a resolução pública e libera uma posição.
- A reativação exige capacidade disponível e devolve o Link ao estado ativo.
- A listagem usa `page` iniciando em 1 e `limit`, com padrão 20 e máximo 100; a resposta contém itens e metadados de página.
- A listagem mostra Links Ativos por padrão e permite incluir Links Desativados.
- A listagem ordena Links do mais recente para o mais antigo, usando o identificador público como desempate.

### Base pública

- A base pública da URL Curta é uma origem HTTPS, sem caminho, query string ou fragmento.
- O Código Encurtado é sempre publicado diretamente em `/{code}`.

## Referências específicas

- `CONTEXT.md` define o vocabulário canônico do contexto.
- `PROGRESS.md` registra as decisões e a relação com o documento histórico.
- `API para encurtar links multitenant.md` é somente contexto histórico; onde divergir desta feature, esta SPEC e este contexto prevalecem.

## Ideias adiadas

- Alias personalizado.
- Domínio personalizado ou namespace por tenant.
- Métricas, contagem de cliques e relatórios.
- Exclusão definitiva de Links.
- Edição da URL de Destino.
