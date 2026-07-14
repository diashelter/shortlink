# Requisitos de autenticação

## Objetivo

Permitir que um Usuário crie e ative sua conta, conclua login com senha e verificação por e-mail, renove sua sessão e recupere o acesso com segurança. O único papel inicial é `USER`, restrito aos Links que criou.

## Regras de conta e senha

- Uma conta é criada como **pendente** e só fica **ativa** após a verificação do e-mail.
- O e-mail é normalizado para remoção de espaços nas extremidades e letras minúsculas antes de validação, unicidade e rate limiting.
- A senha é preservada exatamente como enviada: não recebe `trim`, normalização nem sanitização.
- A senha deve ter ao menos oito caracteres, uma letra maiúscula, uma minúscula, um número e um caractere especial.
- A senha é persistida somente como hash bcrypt com custo 12.
- Senhas, códigos, refresh tokens e tokens de redefinição nunca entram em logs.

## Códigos e desafios

- O Código de Verificação é numérico, tem seis dígitos, é de uso único e expira em uma hora.
- Há finalidades separadas para ativação de conta e conclusão de login.
- Um novo reenvio, permitido após 60 segundos, invalida o código anterior da mesma finalidade.
- O código é armazenado no Redis apenas como hash ou HMAC.
- Após cinco falhas combinadas de senha ou Código de Verificação, o login da conta fica bloqueado por uma hora.

## Sessões e tokens

- O access token é um JWT retornado no corpo da resposta, mantido apenas em memória pelo cliente e válido por 15 minutos.
- O refresh token é entregue exclusivamente em cookie `HttpOnly`, `Secure` e `SameSite=Lax`, válido por sete dias.
- Uma sessão tem `sessionId` UUID v4, hash do refresh token, hash do token CSRF, expiração, rotação e estado de revogação.
- Apenas uma sessão pode estar ativa por Usuário. Um novo login revoga todas as sessões anteriores.
- Logout, redefinição de senha e novo login revogam a sessão e invalidam imediatamente access tokens emitidos para ela.
- O JWT inclui o `sessionId`; cada rota protegida verifica se a sessão permanece ativa.
- A rotação do refresh token invalida o token anterior. Sua reutilização é detectada e revoga a sessão.

## Persistência e cache distribuído

- PostgreSQL é a fonte de verdade para Usuários, Sessões de Autenticação, hashes de refresh token, revogações, tokens de redefinição e auditoria.
- Redis guarda apenas estado efêmero distribuído: códigos, contadores de falha, bloqueios, rate limits e cache de sessões ativas.
- A validação de sessão consulta o Redis. Em ausência da chave ou indisponibilidade do Redis, consulta o PostgreSQL e tenta repopular o cache.
- Nenhuma instância da API mantém estado de autenticação em memória local.

## Endpoints

Todos os endpoints usam o prefixo `/api/v1/auth`.

| Método e rota | Finalidade |
| --- | --- |
| `POST /register` | Cria uma Conta Pendente e envia o código de ativação. |
| `POST /verify-email` | Valida o código de ativação e torna a conta ativa. |
| `POST /resend-email-verification` | Reenvia o código de ativação, respeitando o intervalo mínimo. |
| `POST /login` | Valida e-mail e senha e cria um Desafio de Login. |
| `POST /verify-login` | Valida o código do desafio, cria a sessão e retorna o access token. |
| `POST /refresh` | Rotaciona o refresh token e retorna um novo access token. |
| `POST /logout` | Revoga a sessão e remove o cookie de refresh token. |
| `POST /forgot-password` | Solicita o envio de um link de redefinição. |
| `POST /reset-password` | Valida o token, altera a senha e revoga todas as sessões. |

`POST /verify-login` retorna `accessToken`, `expiresIn` e o token CSRF; também configura o cookie de refresh token. O token CSRF deve ser enviado no cabeçalho `X-CSRF-Token` em `POST /refresh` e `POST /logout`.

## Redefinição de senha

- O link contém um token opaco e aleatório no fragmento: `https://frontend/reset-password#token=...`.
- O token é de uso único, expira em uma hora e é persistido somente como hash.
- Um novo pedido invalida qualquer token de redefinição anterior.
- O endpoint de solicitação sempre retorna sucesso genérico, mesmo que o e-mail não exista.

## Proteções de borda

- CORS permite somente origens explicitamente configuradas e usa credenciais; não pode usar origem curinga.
- As rotas que usam cookie validam `Origin` e `Referer`, além do token CSRF.
- Login é limitado a 10 requisições por IP e e-mail a cada 15 minutos.
- Cadastro, reenvio de código e recuperação de senha são limitados a três requisições por e-mail por hora e 10 por IP por hora.
- A API responde somente por HTTPS.

## Contrato de erros

- Credenciais inválidas: `401` com mensagem genérica.
- Conta pendente após senha válida: `403` com código `EMAIL_NOT_VERIFIED`.
- Bloqueio temporário: `429` com cabeçalho `Retry-After: 3600`.
- Erros de validação: `422` com erros por campo.
- Código, desafio ou token inválido, expirado ou já utilizado: resposta genérica, sem revelar a causa.

## Recursos necessários

- Módulo NestJS de autenticação e autorização JWT.
- PostgreSQL para Usuários, Sessões, redefinições e auditoria.
- Redis para estado efêmero, cache e rate limiting.
- Provedor de e-mail encapsulado por uma interface.
- Fila e workers para envio com tentativas de reenvio dos e-mails de ativação, login e redefinição.
- Observabilidade dos eventos de criação e revogação de sessão, bloqueios e redefinições, sem credenciais ou tokens.
