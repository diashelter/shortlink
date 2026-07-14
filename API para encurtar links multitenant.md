API para encurtar links multitenant

path do tenant /{uuid-do-user}

Backend API com NestJS
Banco de dados com PostgreSQL
Cache com Redis
JWT para autenticação
Cripto para geração de código do link

Usuário cria uma conta para acessar o sistema.
Cada usuário pode gerar um total de 10 links.

A Senha sempre deve ser criptografada com bcrypt antes de ser salva no banco de dados
A Senha sempre deve ser correspondente ao padrão do sistema. No caso de ser uma senha fraca, o sistema deve retornar um erro.
O padrão do sistema é:

- Pelo menos 8 caracteres
- Pelo menos 1 letra maiúscula
- Pelo menos 1 letra minúscula
- Pelo menos 1 número
- Pelo menos 1 caractere especial

O sistema vai sempre tratar os dados de entrada removendo espaços em branco e códigos maliciosos.

Sistema com autenticação de 2 fatores (email e senha com verificação de código)

O código de autenticação é gerado aleatoriamente e é valido por 1 hora.
O código de autenticação é enviado via email para o usuário.
O código de autenticação deve conter 6 dígitos.
Letras maiúsculas e números.

O sistema de login vai contar com a autenticação via email e senha.
Após validar a entrada do email e senha o sistema vai enviar um código de autenticação via email para o usuário acessar o sistema.

SECURITY
O sistema vai sempre tratar as requisições como HTTPS.
O sistema vai sempre verificar

AUTH
POST /registrer
Resgistra um usuário

POST /login
Ingressa no sistema
O cliente preenche o email e senha e envia os dados
O sistema valida o email e senha
O sistema envia um código de autenticação via email para o usuário acessar o sistema

POST /verify-code
Verifica o código de autenticação
O cliente preenche o código de autenticação e envia os dados
O sistema verifica o código de autenticação
O sistema retorna um sucesso

POST /reset-password
Recuperar a senha
O cliente clica no link para resetar a senha
O cliente preenche a nova senha, confirma a senha e envia os dados
O sistema atualiza a senha do usuário
O sistema retorna um sucesso

POST /forgot-password
Enviar email para resetar a senha
Cliente preenche o email e envia o email para resetar a senha
O sistema envia um email com um link para resetar a senha
É gerado um token de reset de 1 hora de validade
O cliente clica no link e é redirecionado para a página de resetar a senha
O cliente preenche a nova senha e envia os dados
O sistema atualiza a senha do usuário
O sistema retorna um sucesso

POST /logout
Finaliza a sessão do usuário
O sistema retorna um sucesso

CORE
Após autenticado o usuário pode acessar uma página principal onde pode criar um link encurtado.

O sistema vai sempre verificar se o usuário está autenticado antes de permitir acessar a página principal.
Se o usuário não estiver autenticado, o sistema vai retornar um erro 401
{
"error": "Unauthorized"
}
O sistema vai sempre verificar se o usuário tem permissão para acessar a página principal.
Se o usuário não tiver permissão, o sistema vai retornar um erro 403
{
"error": "Forbidden"
}

O sistema vai trabalhar com id inteiro e uuid.
O id inteiro vai ser usado para o id do link gerado pelo sistema.
O uuid vai ser gerado aleatoriamente e vai ser usado para os usuários dos sistemas e demais tabelas que precisam de um identificador único.
O código encurtado vai ser gerado com 6 caracteres aleatórios e maiúsculos não podendo ser repetido pelo mesmo usuário.
O link original vai ser o link que o usuário quer encurtar.
O link encurtado vai ser o link que o usuário vai usar para acessar o link original.
Na tabela de links o sistema vai armazenar o id inteiro, o uuid do usuário, o código encurtado, o link original e o link encurtado.

GET /
Vai listar os links já criados.
O sistema retorna uma lista de links com o seguinte formato:
{
"id": 1,
"user_id": "uuid-do-usuario",
"short_link": "XPADEZ001",
"original_url": "https://www.google.com",
"created_at": "2021-01-01T00:00:00.000Z",
"updated_at": "2021-01-01T00:00:00.000Z"
}

POST /create
Endpoint principal vai criar o código encurtado

O cliente preenche o link original e envia os dados
O sistema cria o código encurtado
O sistema retorna o código encurtado
{
"id": 1,
"user_id": "uuid-do-usuario",
"short_link": "XPADEZ001",
"original_url": "https://www.google.com",
"created_at": "2021-01-01T00:00:00.000Z",
"updated_at": "2021-01-01T00:00:00.000Z"
}

GET /{crypt-link}
Vai redirecionar para o link original

O sistema busca o link original na tabela de links
O sistema retorna o link original se encontrado
{
"original_url": "https://www.google.com"
}
Se o link original não for encontrado, o sistema retorna um erro 404
{
"error": "Link não encontrado"
}
