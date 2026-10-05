# Política de Segurança

O **Jonjo** lida com contas de usuários (senhas com hash), sessões e acesso a
salas de voz e de tela. Se você encontrou uma falha de segurança, obrigado por
reportar com responsabilidade.

## Como reportar uma vulnerabilidade

**Não abra uma issue pública** para falhas de segurança: isso exporia o
problema antes da correção.

Use o canal privado do GitHub:

1. Acesse a aba **Security** do repositório.
2. Clique em **Report a vulnerability** (Private vulnerability reporting).
3. Descreva o problema, o impacto e, se possível, um passo a passo para
   reproduzir.

Se não conseguir usar esse canal, procure o professor responsável pelo projeto
pessoalmente ou pelos canais oficiais da universidade.

## O que esperar

- Confirmamos o recebimento em até **7 dias**.
- Avaliamos e, se confirmado, trabalhamos numa correção priorizada.
- Damos crédito a quem reportou, se você quiser.

## Versões suportadas

Só a branch `main` recebe correções de segurança.

## Escopo

São especialmente bem-vindos relatos sobre:

- Bypass de autenticação ou falsificação do cookie de sessão.
- Escalonamento de privilégio (`pobre` → `rico` → `presidente`).
- Emissão de token do LiveKit para sala, servidor protegido ou canal lotado sem
  autorização.
- Vazamento de hashes de senha, segredos ou dados de outros usuários.
- XSS, injeção ou path traversal na API ou no frontend.

**Fora do escopo:** ataques de negação de serviço volumétricos, engenharia
social e falhas em instâncias de terceiros que rodam versões modificadas.

**Teste somente na sua instância local.** Não faça testes de intrusão contra a
instância pública de outra pessoa sem autorização por escrito.

## Modelo de segurança atual

O que o projeto já faz:

- Senhas de usuários e de servidores com **scrypt + salt** aleatório, comparadas
  com `timingSafeEqual`.
- Sessão em cookie **`HttpOnly`, `SameSite=Lax`** e `Secure` sob HTTPS,
  assinado com HMAC-SHA256 (`SESSION_SECRET`), validade de 7 dias.
- Tokens do LiveKit emitidos só para usuários logados, presos a uma sala, com
  validade de 12h.
- Limite de tentativas por IP no login, cadastro e emissão de token.
- Corpo JSON limitado a 8 kB; nomes de usuário, servidor e canal sanitizados.
- Arquivos de dados gravados com permissão `0600`.

## Limitações conhecidas (boas oportunidades de contribuição)

Estes pontos são conhecidos e **podem virar issues** para quem quer aprender
segurança na prática. Discuta na issue antes de implementar.

- **Sessão sem revogação:** o cookie é stateless. Logout apaga o cookie no
  navegador, mas um cookie copiado continua válido até expirar. Trocar o cargo
  de um usuário não invalida sessões antigas.
- **Limite de tentativas em memória:** zera ao reiniciar e não funciona com
  várias instâncias. O mapa `loginAttempts` também nunca é limpo.
- **Sem cabeçalhos de segurança HTTP** (CSP, `X-Content-Type-Options`,
  `Referrer-Policy`, `frame-ancestors`).
- **Cookie malformado** pode gerar erro 500 (`decodeURIComponent` sem
  `try/catch` em `parseCookies`).
- **Enumeração de usuários:** o cadastro responde 409 para usuário existente, e
  o tempo de resposta do login difere entre usuário existente e inexistente.
- **Política de senha fraca:** mínimo de 6 caracteres, sem verificação contra
  senhas vazadas.
- **Qualidade de tela por cargo é aplicada só no cliente.** O controle real é o
  login; o LiveKit não limita bitrate pelo token.
- **Primeiro cadastro vira presidente** quando `PRESIDENT_USERNAME` está vazio.
  Em produção, defina essa variável antes de abrir o site.
- **Imagem `livekit/livekit-server:latest`** não está fixada numa versão.

## Boas práticas para quem contribui

- **Nunca comite** `.env`, `livekit.runtime.yaml`, a pasta `data/` ou qualquer
  chave real. Só arquivos `*.example` com valores fictícios entram no repo.
- Se comitou um segredo por engano, **avise imediatamente**: apagar o commit não
  basta, o segredo precisa ser trocado.
- Valide e normalize **toda** entrada do usuário no servidor; nunca confie no
  cliente.
- **Nunca logue** senhas, tokens, cookies ou o conteúdo de `users.json`.
- Não adicione dependências sem necessidade; rode `npm audit` ao adicionar.
