# Matriz de testes

**Status**: Definida para a feature de autenticação  
**Atualizada em**: 2026-07-13

## Ambiente obrigatório

Todos os comandos executam dentro do serviço `api`. Antes de testes de integração ou E2E, a stack deve estar disponível:

```bash
docker compose up --detach
```

## Camadas e comandos

| Camada | Objetivo | Localização | Comando |
| --- | --- | --- | --- |
| Unitário | Value Objects, serviços com interfaces simuladas, guards e conversão de erros | `src/**/*.spec.ts` | `docker compose exec api npm run test -- --runInBand` |
| Integração | TypeORM/PostgreSQL, Redis, Lua/TTL, transações e adapters externos | `test/integration/**/*.integration-spec.ts` | `docker compose exec api npm run test:integration -- --runInBand` |
| E2E | Contratos HTTP, cookies HTTPS, CORS/CSRF, Mailpit e fluxos P1 | `test/e2e/**/*.e2e-spec.ts` | `docker compose exec api npm run test:e2e -- --runInBand` |
| Qualidade | Tipagem, lint e build | Repositório | `docker compose exec api npm run lint && docker compose exec api npm run build` |

`test:integration` será adicionado ao `package.json` durante a implementação da autenticação. A configuração de cada suíte deve isolar seu banco, chaves Redis e caixa de e-mail para evitar interferência entre casos.

## Gate checks

| Gate | Comando | Quando usar |
| --- | --- | --- |
| Unitário | `docker compose exec api npm run test -- --runInBand` | Após Value Objects, serviços, guards ou filtros. |
| Integração | `docker compose exec api npm run test:integration -- --runInBand` | Após entidades, migrations, repositórios, Redis ou filas. |
| E2E | `docker compose exec api npm run test:e2e -- --runInBand` | Após endpoint ou fluxo público/protegido. |
| Completo | `docker compose exec api npm run lint && docker compose exec api npm run build && docker compose exec api npm run test -- --runInBand && docker compose exec api npm run test:integration -- --runInBand && docker compose exec api npm run test:e2e -- --runInBand` | Ao fim de uma fase ou da feature. |

## Co-localização obrigatória

- Cada tarefa que cria comportamento de domínio inclui os testes unitários correspondentes.
- Cada tarefa que cria persistência, Redis, fila ou transação inclui seus testes de integração.
- Cada tarefa que publica ou altera endpoint inclui seus testes E2E.
- Testes não são adiados para uma tarefa final; a tarefa que introduz o comportamento o verifica.
- Testes executam sequencialmente (`--runInBand`); portanto, tarefas com testes não são paralelas durante a execução.

## Critérios de qualidade

- Nenhum teste pode ser removido ou marcado como skip para aprovar uma tarefa.
- Toda falha deve ser reproduzível sem `sleep` arbitrário.
- E2E HTTPS deve confiar na CA local; não pode desabilitar a validação TLS.
- Credenciais, códigos e tokens não podem aparecer em snapshots, mensagens de falha ou logs de testes.
