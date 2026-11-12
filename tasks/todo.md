# Tarefas: Player de Música

Spec: [`../SPEC.md`](../SPEC.md) · Plano: [`plan.md`](plan.md)

Comandos: `node --test` (testes) · `git push origin main` (publica no Pages em cerca de 1 min).

Pronto, em toda tarefa, significa:
- os testes passam;
- o checklist manual no iPhone foi feito pela URL do Pages;
- há um commit.

---

## Fase 0: Contas e protótipo de risco

### T0: Contas, repositório e credencial Google

**Descrição:** Deixar tudo pronto para publicar e fazer login. Algumas etapas são suas, porque envolvem senhas e criar contas.
1. Você: criar uma conta no GitHub e rodar `gh auth login`.
2. Eu: escrever `docs/google-cloud.md`, rodar `git init`, criar o repositório público e ativar o Pages.
3. Você: criar a credencial OAuth seguindo `docs/google-cloud.md`, com a origem `https://<usuario>.github.io`, e me passar o Client ID.
4. Você: subir pelo menos 3 MP3s (de um mesmo álbum) para `Músicas`.

**Critérios de aceite:**
- [x] `gh auth status` mostra que está logado, e o Pages responde em `https://joaogabrielchiconi.github.io/player-musica/`.
- [x] O Client ID está em `js/config.js`, e você está como usuário de teste na tela de consentimento.
- [ ] A pasta `Músicas` tem pelo menos 3 faixas.

**Verificação:**
- [ ] Manual: abrir a URL do Pages no iPhone e ver uma página de teste.

**Depende de:** nada · **Arquivos:** `docs/google-cloud.md`, `js/config.js`, `.gitignore`, `index.html` (placeholder) · **Tamanho:** S

---

### T1: Protótipo: login, listar pasta, 3 faixas com tela bloqueada

**Descrição:** Código descartável (`proto/`) que prova os três riscos do iOS com o app instalado na Tela de Início:
- entrar com o Google, testando popup e redirecionamento;
- achar a pasta `Músicas` e listar as faixas;
- tocar em sequência, a partir de Blob, pré-carregando a próxima, com Media Session.

Também mede o tempo entre o toque e o início do som.

**Critérios de aceite:**
- [x] No app instalado, o login funciona por pelo menos um dos fluxos, e o fluxo que funcionou fica anotado aqui.
- [x] As 3 faixas tocam até o fim com a tela bloqueada, e play/pause/próxima/anterior funcionam na tela de bloqueio, com título.
- [x] O tempo até começar a tocar no 4G está anotado aqui.

**Verificação:**
- [x] Manual: instalar na Tela de Início, bloquear a tela e ouvir as 3 faixas. Repetir no 4G.

**Depende de:** T0 · **Arquivos:** `proto/index.html`, `proto/proto.js`, `manifest.webmanifest`, `icons/icon-180.png` · **Tamanho:** M

**Resultados (12/11/2026, app instalado no iPhone):**
- **Tela bloqueada:** a v1 trocava de faixa sem som. A v2 funcionou com `navigator.audioSession.type = 'playback'` e dois elementos `<audio>` (a próxima faixa começa cerca de 1 s antes do fim da atual). **As duas medidas são obrigatórias no app final.**
- **Tela de bloqueio:** mostrava ±10 s. Desde a v3, mostra ⏮ ⏭: sem os controles nativos do `<audio>`, sem `seekbackward`/`seekforward`, e com `previoustrack`/`nexttrack` registrados de novo a cada faixa. Confirmado na v4.
- **Anterior/próxima:** funcionam na v4. Ela guarda as 3 últimas faixas na memória e mostra "Carregando…" enquanto baixa.
- **Tempo até tocar:** faixa pré-carregada 0,0 s. Faixa de 111 MB baixou em 11,3 s no Wi-Fi. No 4G e no Wi-Fi, o usuário confirmou que funciona bem (sem medida exata).
- **Versão aprovada:** `proto/` na v4 (commit `cda528f`). É a referência para o `player.js` final.
- **Fluxo de login:** o popup funcionou no app instalado. O redirecionamento não foi testado.
- **Ícone ▶/⏸ da tela de bloqueio:** fica ▶ mesmo tocando. O usuário decidiu deixar assim. As tentativas v5–v7 quebraram a troca automática e foram revertidas para a v4.

### Checkpoint: Go/no-go
- [x] Os critérios 2 e 3 da spec passam no app instalado (o ícone ▶/⏸ é uma exceção aceita).
- [ ] Você decide se seguimos com o PWA. Se não, reavaliamos app nativo ou VLC antes de qualquer outra tarefa.

---

## Fase 1: Fundação

### T2: Banco local (IndexedDB)

**Descrição:** `js/db.js` com um wrapper mínimo (get, put, delete, getAll por store) para os stores `tracks`, `audio`, `art`, `playlists`, `state` e `meta`. Chama `navigator.storage.persist()` na primeira execução.

**Critérios de aceite:**
- [x] Os dados gravados continuam lá depois de fechar e reabrir o app.
- [x] Um Blob de áudio de 10 MB grava e lê de volta no Safari do iPhone.
- [x] `persist()` é chamado, e o resultado aparece no console.

**Verificação:**
- [x] Manual: página de debug no iPhone grava, fecha, reabre e lê.

**Resultado (12/11/2026):** no iPhone, leu 10.485.760 bytes e o conteúdo confere. Cota de cerca de 39 GB. `persist()` retornou `false` no navegador; será conferido de novo no app instalado (T9/T10).

**Depende de:** T1 · **Arquivos:** `js/db.js` · **Tamanho:** S

---

### T3: Login e Drive definitivos

**Descrição:**
- `js/auth.js`: o fluxo vencedor da T1 (popup). A renovação é um toque em "Entrar": o popup tenta `prompt=none` primeiro e mostra a tela do Google só se precisar. Renovação 100% silenciosa não existe sem servidor.
- `js/drive.js`:
  - achar a pasta pelo nome e guardar o ID no `meta`;
  - listar com recursão e paginação;
  - baixar o arquivo inteiro ou uma faixa de bytes (Range);
  - repetir a chamada uma vez depois de renovar o token, se der 401.

**Critérios de aceite:**
- [x] Uma pasta com subpastas e mais de 1000 arquivos é listada por completo (teste com `fetch` falso).
- [x] Num 401, a chamada tenta renovar uma vez (se houver como) e senão falha com `AuthError`: aparece "Entrar" e nenhum dado local é apagado.
- [x] O ID da pasta não aparece em nenhum arquivo do repositório.

**Verificação:**
- [x] `node --test tests/drive.test.js`
- [x] Manual no iPhone (12/11/2026): login por popup OK, listou as 3 faixas em 1,0 s, Range de 64 KB leu a tag ID3, e o token vencido simulado deu `AuthError` sem apagar a pasta salva. Esperar 1 h de verdade fica coberto pela simulação.

**Depende de:** T1 · **Arquivos:** `js/auth.js`, `js/drive.js`, `tests/drive.test.js` · **Tamanho:** M

---

### T4: Leitura de tags

**Descrição:** `js/tags.js` lê título, artista, álbum, número da faixa e capa dos primeiros 64 KB (eram 512 KB; reduzido na T5), ou do tamanho exato da tag ID3 quando ela for maior. Sem tag, usa `titleFromFilename` e o nome da subpasta. Leitor próprio, sem dependência (decisão do usuário).

**Critérios de aceite:**
- [x] Um MP3 com ID3v2 e capa retorna todos os campos e a capa como Blob.
- [x] Um arquivo sem tag retorna os dados do nome do arquivo ("Artista - Título") e o álbum da subpasta.
- [x] Uma capa maior que 512 KB é lida inteira.

**Verificação:**
- [x] `node --test tests/tags.test.js` (9 testes; tags ID3 montadas no próprio teste, sem fixtures binárias).

**Depende de:** T1 · **Arquivos:** `js/tags.js`, `tests/tags.test.js` (tags montadas no próprio teste) · **Tamanho:** M

**Resultado no iPhone (12/11/2026):**
- As 3 faixas reais têm ID3v2.4 só com `TSSE` (`Lavf63.1.102`, gravado pelo ffmpeg do conversor): sem título, artista, álbum ou capa.
- O leitor está certo; os dados vêm do nome do arquivo.
- Para ter artista, álbum e capa: preencher as tags (ex.: Mp3tag), ou usar "Artista - Título" no nome do arquivo e uma subpasta por álbum.

**Resultado no iPhone (12/11/2026):** as 3 faixas reais têm ID3v2.4 só com `TSSE` (Lavf63.1.102, gerado pelo ffmpeg do conversor): sem título, artista, álbum ou capa. O leitor está certo; os dados vêm do nome do arquivo. Para ter artista/álbum/capa: preencher as tags (ex.: Mp3tag) ou usar "Artista - Título" no nome e uma subpasta por álbum.

### Checkpoint: Fundação
- [x] `node --test` passa.
- [x] Quando o token vence, o app pede "Entrar" sem quebrar nem perder dados.

---

## Fase 2: Biblioteca

### T5: Sincronizar a biblioteca com o Drive

**Descrição:** `js/library.js`:
- `diffLibrary(driveFiles, localTracks)` separa faixas novas, alteradas (pelo `md5Checksum`) e removidas.
- Faixas novas e alteradas têm as tags lidas; as capas vão para `art`, uma por álbum.
- Faixas removidas ganham a flag `removedFromDrive`. Nenhuma é apagada.
- A sincronização roda ao abrir (com internet) e pelo botão "Atualizar biblioteca", mostrando o progresso.

**Critérios de aceite:**
- [x] Uma faixa nova no Drive aparece depois de "Atualizar".
- [x] A segunda sincronização sem mudanças não baixa nenhum byte de áudio.
- [x] Faixa apagada do Drive continua no `db`, marcada como removida.

**Verificação:**
- [x] `node --test tests/library.test.js`
- [x] Manual no iPhone (12/11/2026): 3 músicas sincronizadas; 2ª rodada "nada mudou"; faixa tirada do Drive ficou com "removida do Drive"; ao voltar, foi lida de novo e a marca saiu.

**Depende de:** T2, T3, T4 · **Arquivos:** `js/library.js`, `js/app.js`, `tests/library.test.js` · **Tamanho:** M

---

### T6: Abas Músicas, Artistas e Álbuns, com busca

**Descrição:**
- Telas funcionais e simples, ainda sem o design final.
- Funções puras de agrupamento e ordenação: `groupByAlbum` e `groupByArtist`.
- Busca por título, artista e álbum, sem diferenciar acentos nem maiúsculas.
- Tocar numa faixa ainda chama o player do protótipo.

**Critérios de aceite:**
- [ ] As 3 abas listam a biblioteca, e o álbum mostra as faixas em ordem, com a capa.
- [ ] Buscar "jose" encontra "José".
- [ ] Uma lista com 2000 faixas rola sem travar no iPhone.

**Verificação:**
- [ ] `node --test tests/library.test.js`
- [ ] Manual: navegar pelas abas no iPhone.

**Depende de:** T5 · **Arquivos:** `index.html`, `js/ui.js`, `js/library.js`, `css/app.css`, `tests/library.test.js` · **Tamanho:** M

---

## Fase 3: Player

### T7: Player completo, com mini player e tela cheia

**Descrição:** `js/player.js`:
- fila, próxima, anterior, aleatório, repetir uma e repetir tudo;
- tocar a lista a partir da faixa escolhida (álbum, artista, busca);
- pré-carregar a próxima faixa;
- Media Session com capa;
- arrastar a barra de progresso.

Mini player fixo embaixo, que abre o player em tela cheia com a fila.

**Critérios de aceite:**
- [ ] A lógica da fila (aleatório sem repetir até acabar, repetir, anterior depois de 3 s volta ao início da faixa) passa nos testes.
- [ ] O critério 3 da spec passa com um álbum tocado pela tela de Álbuns.
- [ ] A capa aparece na tela de bloqueio.

**Verificação:**
- [ ] `node --test tests/queue.test.js`
- [ ] Manual: tela bloqueada, com AirPods/fones se houver.

**Depende de:** T6 · **Arquivos:** `js/player.js`, `js/queue.js`, `js/ui.js`, `tests/queue.test.js` · **Tamanho:** M

---

### T8: Continuar de onde parou

**Descrição:** Salvar no `state` a fila, o índice, a posição (a cada ~5 s e ao pausar), o aleatório e o repetir. Restaurar ao abrir, com a faixa pausada no ponto salvo.

**Critérios de aceite:**
- [ ] Fechar o app pelo seletor de apps e reabrir mostra a mesma faixa, no ponto salvo (±5 s), com a mesma fila.
- [ ] Um `state` corrompido ou com faixa que não existe mais não quebra o app: ele abre com o player vazio.

**Verificação:**
- [ ] `node --test tests/queue.test.js` (serialização do estado)
- [ ] Manual no iPhone.

**Depende de:** T7 · **Arquivos:** `js/player.js`, `js/queue.js`, `tests/queue.test.js` · **Tamanho:** S

### Checkpoint: Player
- [ ] Os critérios 2, 3, 4 e 8 da spec passam no iPhone.
- [ ] Revisão com você antes do offline.

---

## Fase 4: Offline

### T9: App abre sem internet e faixas não baixadas ficam apagadas

**Descrição:**
- `sw.js` guarda os arquivos do app e serve-os sem internet. A versão do cache troca a cada publicação.
- O app detecta internet com `navigator.onLine` e também pela falha de uma chamada.
- Faixas não baixadas aparecem apagadas e não tocam sem internet.
- Filtro "Só baixadas".

**Critérios de aceite:**
- [ ] Em modo avião, o app instalado abre e mostra a biblioteca.
- [ ] Sem internet, tocar uma faixa não baixada não faz nada além de um aviso curto.
- [ ] Depois de publicar uma versão nova, o app passa a usá-la na segunda abertura.

**Verificação:**
- [ ] Manual: modo avião no iPhone, mais uma publicação de teste.

**Depende de:** T8 · **Arquivos:** `sw.js`, `index.html`, `js/app.js`, `js/ui.js` · **Tamanho:** M

---

### T10: Baixar, apagar, aba Baixadas e painel de espaço

**Descrição:** `js/offline.js`:
- baixar uma faixa ou um álbum para `audio`, em fila, um arquivo por vez, mostrando o progresso;
- apagar um download;
- aba Baixadas;
- painel de espaço, com a soma dos downloads e o resultado de `storage.estimate()`;
- marcar faixas "removida do Drive".

O player passa a tocar do `audio` quando a faixa está baixada.

**Critérios de aceite:**
- [ ] Um álbum baixado toca inteiro em modo avião, com a tela bloqueada.
- [ ] Apagar um download reduz o espaço mostrado no painel.
- [ ] Um download interrompido (internet caiu) não deixa um arquivo pela metade marcado como baixado.

**Verificação:**
- [ ] Manual no iPhone: baixar, entrar em modo avião, ouvir, apagar.

**Depende de:** T9 · **Arquivos:** `js/offline.js`, `js/player.js`, `js/ui.js`, `index.html` · **Tamanho:** M

---

## Fase 5: Playlists

### T11: Playlists: criar, editar, ordenar, tocar e baixar

**Descrição:** `js/playlists.js`:
- criar, renomear e apagar playlists, com confirmação ao apagar;
- adicionar faixas a partir de qualquer lista;
- remover e reordenar faixas;
- tocar a playlist;
- baixar a playlist inteira (usando a T10).

**Critérios de aceite:**
- [ ] Uma playlist criada com 5 faixas, reordenada, aparece na nova ordem depois de reabrir o app.
- [ ] "Baixar playlist" deixa as 5 faixas tocando offline.
- [ ] Apagar uma playlist não apaga as faixas nem os downloads.

**Verificação:**
- [ ] `node --test tests/playlists.test.js`
- [ ] Manual no iPhone.

**Depende de:** T8, T10 · **Arquivos:** `js/playlists.js`, `js/ui.js`, `index.html`, `tests/playlists.test.js` · **Tamanho:** M

---

### T12: Backup e restauração das playlists no Drive

**Descrição:**
- Gravar `playlists.json` no `appDataFolder` com debounce de ~3 s depois de cada mudança.
- Restaurar quando o `db` estiver sem playlists e o backup existir.
- Formato com `version: 1`. As faixas são guardadas pelo ID do Drive.

**Critérios de aceite:**
- [ ] Apagar os dados do app (Ajustes > Safari > Avançado > Dados de Sites) e entrar de novo restaura as playlists (critério 7).
- [ ] Nenhuma chamada de escrita sai do `appDataFolder` (conferir `drive.js`).
- [ ] Um backup com uma faixa que não existe mais é restaurado sem essa faixa, e o app avisa.

**Verificação:**
- [ ] `node --test tests/playlists.test.js` (serialização)
- [ ] Manual no iPhone.

**Depende de:** T11, T3 · **Arquivos:** `js/playlists.js`, `js/drive.js`, `tests/playlists.test.js` · **Tamanho:** S

### Checkpoint: Offline e playlists
- [ ] Os critérios 5, 6 e 7 da spec passam no iPhone em modo avião.

---

## Fase 6: Acabamento

### T13: Design das telas com `impeccable`

**Descrição:** Aplicar a skill `impeccable`:
- tema escuro, tipografia, espaçamentos;
- mini player e player em tela cheia;
- estados vazios ("pasta vazia", "sem downloads") e estados de carregamento e sincronização.

Respeitar a área segura do iPhone (notch e barra inferior).

**Critérios de aceite:**
- [ ] Todas as telas seguem um só sistema visual, aprovado por você.
- [ ] Nada fica escondido sob o notch ou sob a barra de início, no modo instalado.
- [ ] Os alvos de toque têm pelo menos 44 pt.

**Verificação:**
- [ ] Manual no iPhone, mais capturas de tela para aprovação.

**Depende de:** T12 · **Arquivos:** `css/app.css`, `index.html`, `js/ui.js` · **Tamanho:** M

---

### T14: Ícones, acessibilidade, revisão de segurança e checklist final

**Descrição:**
- Ícones finais e manifesto completo.
- Rótulos de acessibilidade em todos os botões só de ícone, e contraste AA.
- `security-review`, com foco em token, escopos e escrita no Drive.
- Percorrer os 10 critérios de sucesso da spec.

**Critérios de aceite:**
- [ ] O VoiceOver lê todos os controles do player.
- [ ] A revisão de segurança não deixa nenhum achado alto sem correção.
- [ ] Os 10 critérios da spec foram marcados como verificados no iPhone.

**Verificação:**
- [ ] `node --test`
- [ ] Manual: o checklist final abaixo.

**Depende de:** T13 · **Arquivos:** `manifest.webmanifest`, `icons/*`, `index.html`, `css/app.css` · **Tamanho:** S

### Checkpoint final
- [ ] 1 Instalação · 2 Login · 3 Tela bloqueada · 4 Biblioteca · 5 Offline
- [ ] 6 Espaço · 7 Backup · 8 Retomar · 9 Drive intacto · 10 Testes
