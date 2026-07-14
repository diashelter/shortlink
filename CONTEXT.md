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

## Links

**Link**:
Recurso criado por um Usuário que associa uma URL de Destino a um Código Encurtado globalmente único.
_Evitar_: URL curta, link original, redirecionamento

**URL de Destino**:
Endereço web absoluto HTTP ou HTTPS, sem credenciais embutidas, para o qual um Link direciona quem acessa sua URL Curta.
_Evitar_: Link original, URL encurtada

**Código Encurtado**:
Identificador público alfanumérico de seis caracteres em maiúsculas, globalmente único, que compõe a URL Curta de um Link.
_Evitar_: ID interno, UUID do Usuário, código criptografado

**URL Curta**:
URL pública composta pelo domínio da plataforma e pelo Código Encurtado, acessível sem autenticação.
_Evitar_: URL de Destino, link original

**Link Ativo**:
Link que conta para o limite de dez Links de seu Usuário e pode redirecionar para sua URL de Destino.
_Evitar_: Link criado, histórico de Links

**Link Desativado**:
Link que não redireciona e não conta para o limite de dez Links Ativos de seu Usuário, mas preserva sua identidade e pode ser reativado.
_Evitar_: Link excluído, Link removido

**Reativação de Link**:
Retorno de um Link Desativado ao estado de Link Ativo, condicionado à disponibilidade no limite de dez Links Ativos do seu Usuário.
_Evitar_: Recriação de Link, restauração de URL

## Estatísticas de Acesso

**Acesso**:
Redirecionamento HTTP bem-sucedido de uma URL Curta ativa para a URL de Destino associada.
_Evitar_: Tentativa de acesso, visualização da página de destino

**Evento de Acesso**:
Registro individual de um Acesso, associado a um Link, que sustenta a contagem de cliques e a agregação por data UTC, país e identificador pseudonimizado.
_Evitar_: Clique agregado, log técnico

**Identificador de Visitante Pseudonimizado**:
Identificador derivado temporariamente do IP e do user-agent de uma requisição, sem persistir esses valores brutos, usado para reconhecer acessos de um mesmo visitante apenas no mesmo dia.
_Evitar_: IP armazenado, identificador de usuário

**Agregado de Acessos**:
Síntese estatística diária ou mensal, delimitada em UTC, de Eventos de Acesso, usada para consulta histórica sem depender de dados brutos do visitante.
_Evitar_: Evento de acesso, contador em tempo real

**Retenção de Evento de Acesso**:
Política que elimina Eventos de Acesso e identificadores pseudonimizados temporários ao finalizar seu dia UTC às 01:00, preservando somente os Agregados de Acessos.
_Evitar_: Arquivamento de logs, retenção indefinida

**Retenção de Agregado de Acessos**:
Política que preserva os Agregados de Acessos enquanto o Link correspondente existir, inclusive quando estiver desativado.
_Evitar_: Retenção fixa anual, retenção após remoção do Link

**Estatística Eventual**:
Estatística de acesso que pode ficar disponível em até cinco minutos após o redirecionamento, quando a infraestrutura está saudável, para preservar a baixa latência da URL Curta.
_Evitar_: Contagem síncrona, estatística em tempo real

**Disponibilidade da URL Curta**:
Garantia de que a resolução de um Link Ativo continua redirecionando mesmo quando a coleta ou o processamento de estatísticas estiver indisponível.
_Evitar_: Dependência de analytics, falha de redirecionamento por métricas

**Tráfego Automatizado Conhecido**:
Redirecionamento identificado por assinaturas conhecidas de crawler, preview ou monitoramento que não compõe as estatísticas de acesso.
_Evitar_: Acesso humano, visitante único

**Relatório de Link**:
Consulta das estatísticas de um Link disponibilizada exclusivamente ao seu Usuário proprietário, com intervalo padrão dos últimos 30 dias e período customizado de até 12 meses.
_Evitar_: Painel global, relatório público

**Visitante Único Diário**:
Visitante identificado pelo mesmo Identificador de Visitante Pseudonimizado dentro de um mesmo dia e para um mesmo Link.
_Evitar_: Usuário autenticado, visitante recorrente

**Visitantes Únicos Mensais**:
Soma dos Visitantes Únicos Diários do mês; uma mesma pessoa acessando em dias distintos pode contribuir mais de uma vez para esse total.
_Evitar_: Pessoas únicas no mês, visitantes recorrentes mensais

**País de Acesso**:
País inferido localmente a partir do IP recebido temporariamente, persistido no Evento de Acesso sem o IP bruto.
_Evitar_: Localização exata, endereço IP

**País Desconhecido**:
Valor de agrupamento usado quando o País de Acesso não puder ser inferido, sem descartar o Evento de Acesso nem reduzir a contagem total.
_Evitar_: Erro de acesso, país ausente
