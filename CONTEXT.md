# Shortlink

Contexto responsável pela identidade dos usuários e pelo acesso autenticado à API de encurtamento de links.

## Identidade

**Conta Pendente**:
Conta recém-cadastrada cujo endereço de e-mail ainda não foi verificado e que não pode iniciar uma Sessão de Autenticação.
_Evitar_: Conta ativa, usuário autenticado

**Conta Ativa**:
Conta cujo endereço de e-mail foi verificado e que pode iniciar uma Sessão de Autenticação.
_Evitar_: Conta pendente, sessão ativa

**Usuário**:
Titular de uma Conta Ativa que possui o papel `USER` e acessa exclusivamente os Links que criou.
_Evitar_: Administrador, tenant

## Autenticação

**Access Token**:
JWT válido por 15 minutos, entregue no corpo da resposta e mantido apenas em memória pelo cliente.
_Evitar_: Token de sessão, token persistente

**Refresh Token**:
Credencial válida por sete dias, entregue em cookie `HttpOnly`, `Secure` e `SameSite=Lax`, cuja referência persistida no servidor é somente seu hash.
_Evitar_: JWT de acesso, token em localStorage

**Sessão de Autenticação**:
Vínculo revogável entre um Usuário e um Refresh Token, usado para renovar o acesso autenticado.
_Evitar_: Login, access token

**Identificador de Sessão**:
UUID v4 aleatório que identifica uma Sessão de Autenticação e é incluído no Access Token para permitir sua invalidação imediata.
_Evitar_: ID do usuário, refresh token

**Sessão Ativa**:
Única Sessão de Autenticação válida de um Usuário; um novo Login revoga todas as sessões anteriores desse Usuário.
_Evitar_: Sessões concorrentes, dispositivo confiável

**Encerramento de Sessão**:
Revogação da Sessão de Autenticação no servidor e remoção do cookie de Refresh Token no cliente.
_Evitar_: Apenas remover o cookie, logout local

**Código de Verificação**:
Código numérico de seis dígitos, de uso único, enviado por e-mail para ativar uma Conta Pendente ou concluir um Login; é válido por até uma hora, pode ser reenviado após 60 segundos e é invalidado quando outro código é reenviado.
_Evitar_: Senha temporária, access token

**Desafio de Login**:
Solicitação temporária vinculada a uma Conta Ativa, criada após a validação de e-mail e senha e concluída somente por um Código de Verificação de Login.
_Evitar_: Sessão de autenticação, código de ativação

**Token de Redefinição de Senha**:
Segredo opaco, aleatório e de uso único que autoriza a definição de uma nova senha para uma Conta; expira após uma hora e é invalidado por um novo pedido de redefinição.
_Evitar_: JWT de acesso, código de verificação

**Bloqueio Temporário**:
Estado de segurança que impede novas tentativas de Login por uma hora após cinco falhas, somando falhas de senha e de Código de Verificação.
_Evitar_: Desativação de conta, banimento
