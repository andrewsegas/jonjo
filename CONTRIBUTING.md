# Contribuindo com o Jonjo

Que bom ter você aqui! 🎉 Este projeto é usado por alunos da universidade para
aprender na prática: WebRTC, React, Node, segurança, Docker e o fluxo de
trabalho de open source. Se esta for a sua **primeira contribuição em open
source**, relaxa: este guia foi escrito pensando em você. Ninguém nasce sabendo,
a gente aprende contribuindo.

## Código de Conduta

Ao participar, você concorda em seguir o nosso
[Código de Conduta](./CODE_OF_CONDUCT.md). Seja gentil: revisamos código, não
pessoas.

## Por onde começar

1. Procure issues com o rótulo **`good first issue`**: são tarefas pequenas e
   bem delimitadas, ideais para a primeira contribuição.
2. Comente na issue dizendo que quer pegá-la, para ninguém trabalhar em dobro.
   Espere um mantenedor confirmar antes de começar.
3. Ficou com dúvida? Pergunte na própria issue. Perguntar faz parte do processo.
4. Não achou nada? A seção "Limitações conhecidas" do [SECURITY.md](./SECURITY.md)
   tem várias ideias. Abra uma issue propondo antes de implementar.

## Abrindo uma issue

Bugs, ideias e dúvidas começam numa issue. O passo a passo completo, com
exemplos de uma issue boa e de uma ruim, está em
[docs/COMO-ABRIR-ISSUE.md](./docs/COMO-ABRIR-ISSUE.md).

> **Falha de segurança não vira issue pública.** Veja o [SECURITY.md](./SECURITY.md).

## Preparando o ambiente

Siga o [passo a passo do README](./README.md#como-rodar-localmente-passo-a-passo).
Em resumo:

```bash
cp .env.example .env
npm install
npm run livekit:up    # requer Docker rodando
npm run dev           # abre em http://localhost:5173
```

## Fluxo de contribuição (passo a passo)

1. **Faça um fork** do repositório (botão **Fork**, no canto superior direito
   do GitHub).
2. **Clone** o seu fork:
   ```bash
   git clone https://github.com/SEU-USUARIO/jonjo.git
   cd jonjo
   ```
3. **Aponte para o repositório original** (para buscar atualizações depois):
   ```bash
   git remote add upstream https://github.com/andrewsegas/jonjo.git
   ```
4. **Crie uma branch** a partir da `main` atualizada, com nome descritivo e o
   número da issue:
   ```bash
   git checkout main
   git pull upstream main
   git checkout -b fix/42-cookie-malformado
   ```
   Prefixos: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`.
5. **Programe.** Siga o estilo do código ao redor (veja "Padrões do projeto").
6. **Rode a verificação** antes de commitar. Precisa estar tudo verde:
   ```bash
   npm run check && npm test && npm run build
   ```
7. **Teste de verdade no navegador**, principalmente se mexeu em voz, tela ou
   login. Se possível, com duas janelas (uma anônima) no mesmo canal.
8. **Commite** seguindo Conventional Commits **em português** (veja abaixo).
9. **Envie** para o seu fork e **abra um Pull Request** para a `main` do
   repositório original:
   ```bash
   git push origin fix/42-cookie-malformado
   ```
   No GitHub vai aparecer o botão **Compare & pull request**. Preencha o
   template e vincule a issue (ex.: `Closes #42`).
10. Um mantenedor revisa. Pedidos de ajuste são normais, não desanime. 💪
    Para atualizar o PR, é só commitar e dar `git push` de novo na mesma branch.

### Mantendo seu fork atualizado

```bash
git checkout main
git pull upstream main
git push origin main
```

## Conventional Commits (em português)

Formato: `tipo: descrição no imperativo`.

| Tipo | Quando usar |
|---|---|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `docs` | Só documentação |
| `refactor` | Refatoração sem mudar comportamento |
| `test` | Adição ou ajuste de testes |
| `chore` | Infra, configuração, dependências |
| `security` | Correção ou endurecimento de segurança |

Exemplos:

```
feat: permite renomear canais
fix: evita erro 500 com cookie de sessão malformado
docs: explica como testar com duas janelas
security: adiciona cabeçalhos HTTP de segurança
```

## Padrões do projeto

- **Textos de interface em pt-BR**, no tom bem-humorado do Jonjo ("O Jonjo não
  achou esse canal…"). Nomes de variáveis e funções em inglês.
- **TypeScript estrito** no frontend: evite `any`.
- **Toda entrada do usuário é validada e normalizada no servidor**
  (veja as funções `normalize*` em `server/index.mjs`). Nunca confie no cliente.
- Lógica nova no servidor deve vir com **teste** em `server/index.test.mjs`
  sempre que for uma função pura.
- Comente o **porquê** quando a regra não for óbvia, não o que o código faz.
- Mudou variável de ambiente? Atualize o `.env.example` e a tabela do README.
- Não adicione dependências sem justificar no PR.

## Regras que não podem ser quebradas

- **Nunca comite segredos:** `.env`, `livekit.runtime.yaml`, `data/`, chaves ou
  tokens reais. Só arquivos `*.example` com valores fictícios.
- **Nunca logue** senhas, tokens, cookies ou dados de usuários.
- **Não use dados reais de pessoas** em testes, prints ou issues.
- Não teste falhas de segurança contra instâncias públicas de outras pessoas.

## Dúvidas

Abra uma issue usando o template **❓ Dúvida** ou pergunte na issue em que está
trabalhando. Toda pergunta é bem-vinda. Bons commits! 🚀
