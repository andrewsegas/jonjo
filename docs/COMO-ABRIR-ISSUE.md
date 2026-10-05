# Como abrir uma issue (passo a passo)

Uma **issue** é um registro público no GitHub para relatar um bug, propor uma
melhoria ou tirar uma dúvida. É por ela que todo trabalho no Jonjo começa: antes
de programar, a gente combina o que vai ser feito.

> 🔒 **Encontrou uma falha de segurança?** Não abra issue. Siga o
> [SECURITY.md](../SECURITY.md) para reportar em privado.

## Antes de abrir

1. **Procure se já existe.** Na aba **Issues**, use a busca com palavras-chave
   (ex.: `microfone`, `tela cheia`, `login`). Lembre de remover o filtro
   `is:open` para ver também as fechadas.
2. **Se já existe**, não abra outra: comente nela com informações novas ou
   reaja com 👍 para mostrar que também te afeta.
3. **Confirme que é reproduzível** na versão mais recente da `main`, rodando
   localmente (veja o [README](../README.md#como-rodar-localmente-passo-a-passo)).

## Abrindo

1. Acesse a aba **Issues** do repositório.
2. Clique em **New issue**.
3. Escolha o template certo:

   | Template | Quando usar |
   |---|---|
   | 🐛 **Reportar bug** | Algo não funciona como deveria |
   | 💡 **Sugerir funcionalidade** | Uma ideia nova ou melhoria |
   | ❓ **Dúvida** | Não entendeu algo do código ou de como rodar |

4. Dê um **título curto e específico**. Ele deve dizer o problema sem precisar
   abrir a issue.
5. **Preencha todos os campos obrigatórios** do formulário.
6. Anexe **prints, vídeos curtos ou logs** se ajudarem. Dá para arrastar
   arquivos para o campo de texto.
7. Clique em **Create** (ou **Submit new issue**).

## Escrevendo uma boa issue de bug

O objetivo é que outra pessoa consiga **reproduzir o problema** na máquina dela
sem precisar te perguntar nada.

Inclua:

- **O que aconteceu** e **o que você esperava**.
- **Passos numerados** para reproduzir, a partir de um estado limpo.
- **Ambiente:** navegador e versão, sistema operacional, Node, local ou
  produção.
- **Logs:** console do navegador (F12 → Console), terminal do `npm run dev` e,
  se for mídia, `npm run livekit:logs`.

### ❌ Exemplo ruim

> **Título:** não funciona
>
> O áudio não vai. Arruma aí.

### ✅ Exemplo bom

> **Título:** Áudio some ao trocar de microfone durante a chamada
>
> **O que aconteceu:** depois de trocar o microfone pelo seletor, os outros
> participantes param de me ouvir. O indicador de fala também para de acender.
>
> **Passos para reproduzir:**
> 1. Rodei localmente (`npm run dev` + `npm run livekit:up`).
> 2. Entrei no canal Geral em duas janelas (uma anônima).
> 3. Na janela 1, troquei de "Microfone padrão" para "Headset USB".
> 4. Falei: a janela 2 não recebe áudio.
>
> **Esperado:** continuar sendo ouvido com o novo microfone.
>
> **Ambiente:** Chrome 140, Windows 11, Node 22.12, ambiente local.
>
> **Logs:** no console aparece `NotReadableError: Could not start audio source`.

## Escrevendo uma boa sugestão

- Comece pelo **problema**, não pela solução ("Não sei quem está falando quando
  o canal tem 8 pessoas" é melhor que "Adicionar borda verde").
- Descreva **quem** se beneficia e **como** você imagina que funcionaria.
- Se tiver um esboço de tela, anexe.

## Cuidados

- **Nunca cole segredos** (`.env`, tokens, cookies, chaves) nem **dados de
  outras pessoas** em issues. Revise os logs antes de colar.
- Uma issue = um assunto. Dois bugs diferentes viram duas issues.
- Seja gentil: quem responde também é voluntário ou estudante.

## Depois de abrir

- Um mantenedor vai **classificar** a issue com rótulos (`bug`, `enhancement`,
  `good first issue`, `question`…).
- Pode ser que peçam mais informações: responda na própria issue.
- **Quer resolver você mesmo?** Comente "Posso pegar esta?" e espere a
  confirmação. Depois siga o [fluxo de contribuição](../CONTRIBUTING.md#fluxo-de-contribuição-passo-a-passo).
- Quando o PR que resolve a issue tiver `Closes #NÚMERO` na descrição, ela será
  fechada automaticamente no merge.

## Rótulos usados

| Rótulo | Significado |
|---|---|
| `bug` | Algo quebrado |
| `enhancement` | Melhoria ou nova funcionalidade |
| `question` | Dúvida |
| `good first issue` | Boa para a primeira contribuição |
| `help wanted` | Mantenedores querem ajuda nisto |
| `security` | Endurecimento de segurança (já público, sem risco imediato) |
| `documentation` | Só documentação |
| `needs-triage` | Ainda não foi analisada por um mantenedor |
