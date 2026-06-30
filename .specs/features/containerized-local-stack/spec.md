# SPEC: Stack Local Containerizada

## Status

- Fase: Specify
- Escopo: Grande
- Formato atual: `spec.md` revisado e pronto para gerar `design.md` e `tasks.md`
- Criado em: 2026-06-29
- Revisado em: 2026-06-29

## Contexto

O projeto Shortlink e uma API NestJS que devera usar PostgreSQL como banco de dados, Redis como cache e Mailpit para email em ambiente de desenvolvimento. A partir desta revisao, todo o ambiente local deve executar dentro de containers Docker, incluindo a API NestJS.

Atualmente o projeto possui a estrutura inicial NestJS, scripts npm padrao, `package-lock.json`, porta HTTP `3000` em `src/main.ts`, sem `docker-compose.yml`, sem `.env.example`, sem `Dockerfile` e sem configuracao de infraestrutura versionada.

Esta SPEC define os requisitos para criar uma stack local containerizada com quatro servicos: API NestJS, PostgreSQL, Redis e Mailpit.

## Decisoes Do Usuario

- Revisar a SPEC para ficar pronta para geracao de `design.md`, `tasks.md` e demais passos.
- Todo o projeto deve ser executado dentro de containers Docker.
- Incluir a API NestJS como container no Docker Compose.
- O container da API deve usar modo de desenvolvimento com watch: `npm run start:dev`.
- A imagem base da API deve ser slim e com versao fixa: Node.js 22 slim.
- A API deve ficar acessivel no host pela porta `3000`.
- Criar `Dockerfile` e `.dockerignore` na raiz do projeto.
- Em desenvolvimento, usar bind mount do codigo e volume anonimo para `/app/node_modules`.
- Documentar comandos para executar build, lint e testes via Docker Compose, usando `docker compose exec api npm run ...`.
- PostgreSQL, Redis e Mailpit SMTP devem ficar internos na rede Docker.
- Mailpit UI deve ficar exposta no host.
- O healthcheck da API deve validar o endpoint HTTP raiz `/`.
- A API deve depender de `postgres`, `redis` e `mailpit` saudaveis.
- Renomear a feature para `containerized-local-stack`.
- Planejar `docker-compose.yml`, `.env.example` e uma pasta `infra/`.
- Usar imagens Docker com versoes fixadas, sem tags flutuantes como `latest`.
- Usar imagens slim quando aplicavel.
- Usar nomes padrao do projeto: `shortlink` para banco e usuario; servicos `api`, `postgres`, `redis` e `mailpit`.
- Nao expor PostgreSQL nem Redis diretamente no host.
- Expor somente a interface web do Mailpit para uso local.
- Usar volumes Docker nomeados para persistencia.
- Incluir healthchecks para API, PostgreSQL, Redis e Mailpit.
- Nao configurar integracao NestJS, TypeORM ou cliente Redis nesta etapa.
- Validar a entrega com Docker Compose.
- Versionar `.env.example`; manter `.env` local ignorado pelo Git.

## Objetivos

- Permitir subir a API NestJS, PostgreSQL, Redis e Mailpit com um unico comando Docker Compose.
- Garantir que o desenvolvimento local rode dentro de containers, sem exigir Node.js, PostgreSQL ou Redis instalados no host.
- Permitir hot reload da API NestJS via bind mount e `npm run start:dev`.
- Padronizar variaveis de ambiente locais para infraestrutura.
- Manter dados de PostgreSQL e Redis persistentes entre reinicios dos containers.
- Garantir que todos os servicos tenham healthchecks explicitos.
- Preservar a seguranca basica de desenvolvimento evitando expor banco e cache no host.
- Deixar a estrutura simples, explicita e facil de evoluir por agentes de IA.

## Fora De Escopo

- Instalar ou configurar `@nestjs/typeorm`, `typeorm`, `pg`, Redis client ou `@nestjs/config`.
- Criar entidades, repositories, migrations ou seeds.
- Criar codigo de dominio da aplicacao NestJS.
- Configurar autenticacao, JWT ou envio real de email.
- Criar ambiente de producao.
- Criar pipeline CI/CD.
- Criar Kubernetes, Docker Swarm ou orquestracao fora de Docker Compose.

## Estrutura Planejada

A implementacao devera criar ou atualizar os seguintes caminhos:

```text
.
|-- Dockerfile
|-- .dockerignore
|-- docker-compose.yml
|-- .env.example
`-- infra/
    `-- docker/
        `-- README.md
```

Notas:

- `docker-compose.yml` deve ficar na raiz para manter o comando `docker compose up --detach` simples.
- `Dockerfile` deve ficar na raiz para facilitar build da API e acesso ao contexto do projeto.
- `.dockerignore` deve reduzir contexto de build e evitar copiar artefatos locais desnecessarios.
- `infra/docker/README.md` deve documentar servicos, variaveis, comandos e portas.
- A pasta `infra/` deve centralizar documentacao e futuros artefatos de infraestrutura, sem mover o Compose da raiz nesta etapa.

## Requisitos Funcionais

### INFRA-001: Docker Compose

O projeto deve ter um arquivo `docker-compose.yml` na raiz com quatro servicos: `api`, `postgres`, `redis` e `mailpit`.

Criterios de aceite:

- O arquivo deve ser valido em `docker compose config`.
- Os quatro servicos devem pertencer a mesma rede Docker do projeto.
- O nome dos servicos deve ser exatamente `api`, `postgres`, `redis` e `mailpit`.
- O Compose deve construir a API a partir do `Dockerfile` da raiz.
- O Compose deve carregar variaveis de ambiente a partir de `.env` local quando disponivel.
- O Compose deve funcionar com um `.env` criado a partir de `.env.example`.

### INFRA-002: API NestJS em container

O servico `api` deve executar a aplicacao NestJS dentro de container Docker em modo desenvolvimento.

Criterios de aceite:

- O servico deve usar imagem construida a partir de `Dockerfile` baseado em Node.js 22 slim com tag fixa.
- O comando principal do servico deve executar `npm run start:dev`.
- A API deve escutar na porta interna `3000`.
- A API deve publicar a porta `3000` no host.
- O codigo fonte deve ser montado no container por bind mount para permitir hot reload.
- `/app/node_modules` deve usar volume anonimo para evitar conflito com dependencias do host.
- A API deve depender de `postgres`, `redis` e `mailpit` saudaveis antes de iniciar.
- O servico deve ter healthcheck HTTP contra `/`.
- O container da API nao deve exigir Node.js instalado no host para executar a stack.

### INFRA-003: Dockerfile da API

O projeto deve ter `Dockerfile` na raiz para construir a imagem da API NestJS.

Criterios de aceite:

- O `Dockerfile` deve usar imagem slim com versao fixa de Node.js 22, sem `latest`.
- O `Dockerfile` deve definir diretorio de trabalho estavel, por exemplo `/app`.
- O `Dockerfile` deve copiar `package.json` e `package-lock.json` antes do restante do codigo para aproveitar cache de dependencias.
- O `Dockerfile` deve instalar dependencias com comando compativel com `package-lock.json`, preferencialmente `npm ci`.
- O `Dockerfile` deve expor a porta `3000`.
- O `Dockerfile` deve ter comando padrao compativel com desenvolvimento, mas o Compose pode sobrescrever o comando explicitamente.
- A imagem nao deve depender de arquivos ignorados por `.dockerignore`.

### INFRA-004: Dockerignore

O projeto deve ter `.dockerignore` na raiz para controlar o contexto de build.

Criterios de aceite:

- Deve ignorar `node_modules`, `dist`, `coverage`, logs e arquivos locais de ambiente.
- Nao deve ignorar `package.json`, `package-lock.json`, `src`, `test`, `tsconfig*.json` ou arquivos necessarios para build e execucao.
- Deve evitar copiar `.env` para dentro da imagem.

### INFRA-005: PostgreSQL

O servico `postgres` deve executar PostgreSQL com imagem versionada e configuracao baseada em variaveis de ambiente.

Criterios de aceite:

- A imagem deve usar tag fixa, sem `latest`.
- O banco padrao deve ser `shortlink`.
- O usuario padrao deve ser `shortlink`.
- A senha deve vir de variavel de ambiente documentada em `.env.example`.
- O servico deve usar volume nomeado para persistir dados.
- O servico nao deve expor a porta `5432` no host.
- O servico deve ter healthcheck baseado em disponibilidade do PostgreSQL.
- O servico deve ser acessivel pela API usando o hostname Docker `postgres`.

### INFRA-006: Redis

O servico `redis` deve executar Redis com imagem versionada e persistencia em volume nomeado.

Criterios de aceite:

- A imagem deve usar tag fixa, sem `latest`.
- O servico deve usar volume nomeado para persistir dados.
- O servico nao deve expor a porta `6379` no host.
- O servico deve ter healthcheck baseado em resposta do Redis.
- O servico deve ser acessivel pela API usando o hostname Docker `redis`.
- Redis nao deve ser tratado como fonte de verdade do sistema.

### INFRA-007: Mailpit

O servico `mailpit` deve executar Mailpit com imagem versionada para capturar emails em desenvolvimento.

Criterios de aceite:

- A imagem deve usar tag fixa, sem `latest`.
- A interface web do Mailpit deve ser acessivel no host.
- A porta SMTP deve permanecer disponivel para outros containers na rede Docker.
- A porta SMTP nao precisa ser exposta no host nesta etapa.
- O servico deve ter healthcheck explicito.
- O servico deve ser acessivel pela API usando o hostname Docker `mailpit`.

### INFRA-008: Variaveis de ambiente

O projeto deve ter `.env.example` com as variaveis necessarias para executar a stack containerizada.

Criterios de aceite:

- `.env.example` deve ser versionado.
- `.env` deve continuar ignorado pelo Git.
- As variaveis devem cobrir ambiente da API, porta da API, banco, usuario, senha, Redis, Mailpit e porta publica do Mailpit UI.
- Os valores devem ser seguros o suficiente para desenvolvimento local, sem segredos reais.
- `docker-compose.yml` deve conseguir consumir um `.env` local criado a partir do `.env.example`.
- Variaveis de conexao internas devem usar hostnames Docker, por exemplo `postgres`, `redis` e `mailpit`.

### INFRA-009: Pasta de infraestrutura

O projeto deve ter a pasta `infra/docker/` com documentacao minima da infraestrutura local.

Criterios de aceite:

- `infra/docker/README.md` deve explicar como copiar `.env.example` para `.env`.
- Deve documentar como subir, verificar, executar comandos dentro da API e parar os containers.
- Deve listar os servicos e suas responsabilidades.
- Deve explicar que PostgreSQL e Redis nao sao expostos no host.
- Deve explicar que a API roda em container e que comandos npm devem ser executados via `docker compose exec api`.
- Deve listar comandos para `npm run build`, `npm run lint`, `npm run test` e `npm run test:e2e` dentro do container da API.
- Deve informar a URL local da interface web do Mailpit.

### INFRA-010: Healthchecks e dependencias

Os quatro servicos devem ter healthchecks explicitos no Compose.

Criterios de aceite:

- API deve ser considerada saudavel apenas quando o endpoint HTTP `/` responder.
- PostgreSQL deve ser considerado saudavel apenas quando aceitar conexoes.
- Redis deve ser considerado saudavel apenas quando responder ao ping.
- Mailpit deve ser considerado saudavel apenas quando a interface HTTP responder.
- A API deve usar `depends_on` com condicao de saude para `postgres`, `redis` e `mailpit` quando suportado pelo Docker Compose.

### INFRA-011: Execucao de comandos do projeto

O fluxo de desenvolvimento deve assumir que comandos do projeto rodam dentro do container `api`.

Criterios de aceite:

- A documentacao deve indicar `docker compose exec api npm run build` para build.
- A documentacao deve indicar `docker compose exec api npm run lint` para lint.
- A documentacao deve indicar `docker compose exec api npm run test` para testes unitarios.
- A documentacao deve indicar `docker compose exec api npm run test:e2e` para testes e2e.
- A documentacao nao deve exigir instalar dependencias npm no host para operar a stack.

## Requisitos Nao Funcionais

### NFR-001: Simplicidade

A infraestrutura deve ser direta e facil de entender, sem scripts auxiliares obrigatorios, Makefile obrigatorio ou abstracoes desnecessarias.

### NFR-002: Reprodutibilidade

As imagens Docker devem ter versoes fixadas para reduzir variacao entre ambientes. Tags flutuantes como `latest` nao devem ser usadas.

### NFR-003: Seguranca local

Banco, cache e SMTP nao devem ser expostos no host por padrao. Credenciais reais nao devem ser versionadas.

### NFR-004: Manutenibilidade

Os nomes de servicos, volumes e variaveis devem ser explicitos e alinhados ao dominio `shortlink`.

### NFR-005: Ambiente container-first

O ambiente local deve ser operavel por Docker Compose. O host deve precisar de Docker e Docker Compose, mas nao de Node.js, PostgreSQL, Redis ou Mailpit instalados diretamente.

## Contrato De Portas

- API: porta interna `3000`, publicada no host como `3000`.
- PostgreSQL: porta interna `5432`, sem publicacao no host.
- Redis: porta interna `6379`, sem publicacao no host.
- Mailpit SMTP: porta interna `1025`, sem publicacao obrigatoria no host.
- Mailpit UI: porta publicada no host, padrao esperado `8025`.

## Contrato De Volumes

- PostgreSQL deve usar volume nomeado, por exemplo `shortlink_postgres_data`.
- Redis deve usar volume nomeado, por exemplo `shortlink_redis_data`.
- API deve usar volume anonimo para `/app/node_modules` no Compose de desenvolvimento.
- Mailpit nao precisa de volume persistente nesta etapa.

## Contrato De Servicos

- `api`: executa NestJS em modo desenvolvimento com `npm run start:dev`.
- `postgres`: banco relacional principal do projeto.
- `redis`: cache e infraestrutura auxiliar, nunca fonte de verdade.
- `mailpit`: captura de emails em desenvolvimento.

## Contrato De Imagens

- API: Node.js 22 slim com tag fixa, por exemplo `node:22.11.0-slim` se disponivel no momento da implementacao.
- PostgreSQL: imagem oficial com tag fixa e preferencialmente slim/alpine quando apropriado.
- Redis: imagem oficial com tag fixa e preferencialmente alpine.
- Mailpit: imagem oficial com tag fixa, sem `latest`.

Se uma tag especifica nao existir no registry no momento da implementacao, a implementacao deve escolher a tag fixa oficial mais proxima e registrar a decisao na documentacao.

## Validacao

A implementacao sera considerada valida quando os comandos abaixo passarem:

```bash
rtk docker compose config
rtk docker compose build
rtk docker compose up --detach
rtk docker compose ps
rtk docker compose exec api npm run build
rtk docker compose exec api npm run test
```

Resultados esperados:

- O Compose deve ser parseado sem erros.
- A imagem da API deve ser construida sem erros.
- Os containers `api`, `postgres`, `redis` e `mailpit` devem iniciar.
- Os healthchecks devem indicar todos os servicos saudaveis apos o tempo de inicializacao.
- A API deve responder em `http://localhost:3000/`.
- A UI do Mailpit deve estar acessivel pela porta configurada no host.
- Build e testes devem rodar dentro do container `api`.

## Riscos E Observacoes

- Como PostgreSQL e Redis nao serao expostos no host, ferramentas locais fora do Docker nao conseguirao acessa-los sem portas temporarias, execucao via container ou ajustes futuros.
- O modo `npm run start:dev` com bind mount prioriza experiencia de desenvolvimento, nao imagem de producao.
- O volume anonimo em `/app/node_modules` evita conflito com o host, mas pode exigir rebuild quando dependencias mudarem.
- Esta SPEC intencionalmente nao resolve a integracao da aplicacao com TypeORM ou Redis client.
- A escolha exata das tags fixas das imagens deve ser feita na implementacao usando tags oficiais/disponiveis e sem `latest`.

## Pronto Para Proximas Fases

Esta SPEC esta pronta para gerar:

- `design.md`: definir desenho do Compose, Dockerfile, variaveis e fluxos de desenvolvimento.
- `tasks.md`: quebrar implementacao em tarefas atomicas com verificacao por Docker Compose.
