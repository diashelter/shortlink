# Validação distribuída de sessões com invalidação imediata

O access token incluirá um identificador de sessão UUID v4 e toda rota protegida validará se a sessão está ativa. O PostgreSQL será a fonte de verdade para a sessão e sua revogação; o Redis será seu cache distribuído, com consulta ao PostgreSQL e tentativa de repopulação quando a chave não existir ou o Redis estiver indisponível. Essa decisão preserva a invalidação imediata após logout, redefinição de senha ou novo login sem manter estado nas instâncias da API.
