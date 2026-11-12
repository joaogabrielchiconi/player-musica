# Spec: Player de Música (PWA pessoal para iPhone)

## Suposições

1. O app roda como PWA no Safari do iOS 26, instalado na Tela de Início, num iPhone 17 Pro Max.
2. Há um único usuário e uma única conta Google. O cliente OAuth fica em modo teste, com o dono como único usuário de teste.
3. Não há servidor próprio. Todo o código roda no navegador e é hospedado como arquivos estáticos no GitHub Pages.
4. A pasta de origem se chama `Músicas` e fica na raiz do Meu Drive. Hoje está vazia.
5. Os arquivos são MP3 (320 kbps) ou M4A/AAC, com tags preenchidas. Podem estar em subpastas.

## Objetivo

Ouvir a biblioteca pessoal de músicas guardada no Google Drive sem pagar streaming.

- Tocar qualquer música da pasta pela internet, sem salvá-la no iPhone.
- Baixar músicas ou playlists inteiras escolhidas para ouvir sem internet.
- Criar playlists, com backup no Drive.
- Tocar com a tela bloqueada e controlar pela tela de bloqueio.

**Fora da v1:** equalizador, letras, crossfade, estatísticas, "favoritas" (por enquanto é uma playlist comum), servidor próprio, outros usuários, edição do Drive.

### Histórias de uso

- Abro o app com internet: ele confere a pasta do Drive e mostra as músicas novas.
- Toco um álbum e bloqueio a tela: as faixas seguem uma após a outra, e pauso ou pulo pela tela de bloqueio.
- Toco em "Baixar" numa playlist: todas as faixas ficam disponíveis offline, e vejo o progresso.
- Fico sem internet: a biblioteca continua visível; o que não foi baixado aparece apagado e não toca.
- Reinstalo o app: entro com o Google e minhas playlists voltam do backup.
- Reabro o app: ele continua na mesma música, no mesmo ponto e com a mesma fila.

## Módulos e ordem de construção

É um app pequeno com um usuário, então a spec é uma só. Os módulos abaixo servem de índice para o plano e as tarefas.

| Módulo | Responsabilidade | Depende de |
|---|---|---|
| `auth` | Login Google, token de acesso, renovação | — |
| `drive` | Listar a pasta (com subpastas), baixar bytes, ler e gravar o backup no appDataFolder | `auth` |
| `db` | IndexedDB: biblioteca, áudios baixados, playlists, estado do player | — |
| `tags` | Ler título, artista, álbum, faixa e capa dos bytes iniciais; usar o nome do arquivo quando faltar | — |
| `library` | Sincronizar o Drive com o `db`, agrupar por artista e álbum, buscar | `drive`, `db`, `tags` |
| `player` | Fila, aleatório/repetir, `<audio>`, Media Session, retomar estado | `db`, `drive` |
| `offline` | Baixar e apagar áudios, painel de espaço, service worker do app | `drive`, `db` |
| `playlists` | Criar, editar e ordenar playlists; backup e restauração | `db`, `drive` |
| `ui` | Abas, telas, mini player, player em tela cheia | todos |

**Ordem:** protótipo de risco (`auth` + `drive` + `player` mínimos), depois `db` e `tags`, depois `library`, depois `player` completo, depois `offline`, depois `playlists`, por último `ui` final (design com `impeccable`).

## Decisões técnicas

### Login (`auth`)

- OAuth 2.0 do Google para apps JavaScript.
- Escopos:
  - `https://www.googleapis.com/auth/drive.readonly` para ler a pasta.
  - `https://www.googleapis.com/auth/drive.appdata` para o arquivo de backup, que fica numa pasta escondida e exclusiva do app.
- O token de acesso dura cerca de 1 hora. **Sem servidor, não existe renovação 100% silenciosa:** o Safari bloqueia o login escondido (iframe) e só abre popup depois de um toque. Por isso a renovação é **um toque em "Entrar"**. O popup tenta primeiro sem tela (`prompt=none`) e só mostra a tela do Google se ela for necessária. Tocar o que já foi baixado nunca exige login.
- Num 401, o token é apagado e a chamada falha com `AuthError`. Nenhum dado local é apagado.
- Fluxo de login: **popup**, que foi validado no protótipo com o app instalado.
- O Client ID fica em `js/config.js`. Ele é público por natureza e não é segredo. O app não tem client secret.

### Drive (`drive`)

- Na primeira sincronização, o app procura a pasta pelo nome `Músicas` na raiz e guarda o ID dela no `db`. O ID não vai para o repositório público.
- Listagem: `files.list` com `q = '<pastaId>' in parents and trashed = false`, recursiva nas subpastas. Campos: `id, name, mimeType, size, md5Checksum, modifiedTime`, com `pageSize=1000` e paginação.
- Bytes: `GET https://www.googleapis.com/drive/v3/files/<id>?alt=media` com o cabeçalho `Authorization: Bearer <token>`. As tags são lidas com o cabeçalho `Range`.
- Backup: um único `playlists.json` no `appDataFolder`, regravado (com debounce) a cada mudança de playlist.

### Reprodução (`player`)

- O player sempre toca um Blob (via `URL.createObjectURL`). O caminho é o mesmo para as duas origens:
  - Baixada: o Blob vem do IndexedDB.
  - Pela internet: o arquivo inteiro é baixado para a memória e não é salvo.
- **Obrigatório (validado no protótipo v4, commit `cda528f`; não mudar sem novo teste no iPhone):**
  - `navigator.audioSession.type = 'playback'` antes de cada `play()`. Sem isso, a faixa seguinte toca sem som com a tela bloqueada.
  - **Dois elementos `<audio>`.** A próxima faixa fica pronta no elemento parado e começa cerca de 1 s antes do fim da atual. A anterior só é pausada depois que a nova já está tocando.
  - A próxima faixa é pré-carregada na memória enquanto a atual toca. As 3 últimas faixas ficam em cache na memória.
  - **Sem os controles nativos do `<audio>`.** A interface tem botões próprios.
  - Media Session com `play`, `pause`, `previoustrack`, `nexttrack` e `seekto`, registrados de novo a cada faixa. `seekbackward` e `seekforward` ficam `null`; assim a tela de bloqueio mostra ⏮ ⏭ em vez de ±10 s.
- **Limitação aceita:** o ícone ▶/⏸ da tela de bloqueio fica em ▶ mesmo tocando. As tentativas de correção quebraram a troca automática.
- `shortcut: o arquivo inteiro baixa antes de começar a tocar. Funciona bem no 4G com faixas comuns; arquivos muito grandes (ex.: 111 MB) demoram. Upgrade: streaming com Range, se isso incomodar.`
- Media Session também com título, artista, álbum e capa.
- Estado salvo no `db` (fila, índice, posição a cada ~5 s, aleatório/repetir), e restaurado ao abrir o app.

### Tags (`tags`)

- O app baixa os primeiros 512 KB do arquivo. Se o cabeçalho ID3v2 indicar uma tag maior (capa grande), baixa até o tamanho exato da tag.
- Uma biblioteca de tags, copiada para `vendor/` e sem CDN em tempo de execução. Ela é escolhida na tarefa de `tags` e precisa de aprovação, porque é uma dependência nova.
- Quando faltar tag, o título vem do nome do arquivo sem a extensão; o padrão "Artista - Título" é reconhecido. O artista fica "Desconhecido" e o álbum é o nome da subpasta, ou "Sem álbum".
- Arquivos M4A com o bloco de metadados no fim do arquivo podem cair nesse mesmo caminho do nome do arquivo.
- O app só relê as tags de um arquivo se o `md5Checksum` dele mudar.

### Armazenamento (`db` e `offline`)

- Tudo fica no IndexedDB, num só banco, com estes stores:
  - `tracks`: metadados e uma flag de arquivo removido do Drive.
  - `audio`: Blobs baixados, com o ID do arquivo como chave.
  - `art`: capas, uma por álbum.
  - `playlists`.
  - `state`: estado do player.
  - `meta`: ID da pasta e data da última sincronização.
- O app chama `navigator.storage.persist()` na primeira execução.
- Painel de espaço: usa `navigator.storage.estimate()` e soma os tamanhos dos áudios baixados.
- O service worker guarda os arquivos do app (HTML, CSS, JS, ícones) para que ele abra sem internet. Áudio nunca passa pelo cache do service worker.
- Se uma música baixada sair do Drive, a cópia local continua tocando e fica marcada como "removida do Drive" até o usuário apagar.

### Interface (`ui`)

- Abas: Músicas, Artistas, Álbuns, Playlists, Baixadas. Mini player fixo embaixo; ao tocar nele, abre o player em tela cheia.
- Busca por título, artista e álbum. Filtro "Só baixadas".
- Sem internet, faixas não baixadas aparecem apagadas e não tocam.
- Botão "Atualizar biblioteca", além da sincronização automática ao abrir quando há internet.
- Interface em português do Brasil e tema escuro. O visual detalhado sai da etapa com `impeccable`.
- Acessibilidade: alvos de toque de pelo menos 44 pt, rótulos em todos os botões só de ícone, contraste AA.

## Tech Stack

- HTML, CSS e JavaScript (módulos ES nativos), sem framework, bundler nem etapa de build.
- Uma biblioteca de tags em `vendor/`. Nenhuma outra dependência em tempo de execução.
- Testes: executor de testes nativo do Node (Node v24 instalado), sem dependências.
- Hospedagem: GitHub Pages, publicado a partir da branch `main`, na raiz do repositório.

## Comandos

```bash
# servir localmente para testar no PC
npx --yes serve -l 5173 .

# testes da lógica pura
node --test

# publicar (o GitHub Pages atualiza sozinho em cerca de 1 min)
git push origin main
```

Os testes no iPhone são feitos pela URL do GitHub Pages (HTTPS): `https://<usuario>.github.io/<repo>/`.

## Estrutura do projeto

```
index.html              → shell do app
manifest.webmanifest    → nome, ícones, display: standalone
sw.js                   → service worker (cache dos arquivos do app)
css/app.css             → estilos
js/config.js            → Client ID do Google (público)
js/app.js               → inicialização e roteamento das abas
js/auth.js  js/drive.js  js/db.js  js/tags.js
js/library.js  js/player.js  js/offline.js  js/playlists.js  js/ui.js
vendor/                 → biblioteca de tags (copiada, com licença)
icons/                  → ícones do app
tests/                  → testes da lógica pura (*.test.js)
docs/google-cloud.md    → passo a passo da credencial OAuth
tasks/plan.md  tasks/todo.md
```

## Estilo de código

- Módulos ES com exports nomeados. Uma responsabilidade por arquivo, de acordo com a tabela de módulos.
- Funções puras (agrupar, ordenar, embaralhar, ler o nome do arquivo) ficam separadas do código que acessa DOM, rede ou IndexedDB, para poderem ser testadas no Node.
- Nomes de código em inglês. Textos da interface em português.
- Comentário só para explicar o porquê.

```js
// js/library.js
export function titleFromFilename(name) {
  const base = name.replace(/\.[^.]+$/, '');
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: null, title: base.trim() };
}

export function groupByAlbum(tracks) {
  const albums = new Map();
  for (const t of tracks) {
    const key = `${t.artist}\u0000${t.album}`;
    if (!albums.has(key)) albums.set(key, { artist: t.artist, album: t.album, tracks: [] });
    albums.get(key).tracks.push(t);
  }
  for (const a of albums.values()) a.tracks.sort((x, y) => (x.trackNo ?? 999) - (y.trackNo ?? 999));
  return [...albums.values()];
}
```

## Estratégia de testes

- **Unitários (`node --test`):** a lógica pura, em `tests/*.test.js`.
  - Parsing do nome do arquivo e das tags (com amostras em `tests/fixtures/`).
  - Agrupamento por artista e álbum, e busca.
  - Fila: próxima e anterior, aleatório, repetir uma e repetir tudo.
  - Diferença entre a listagem do Drive e o `db`: novas, alteradas, removidas.
  - Serialização do backup de playlists.
- **Manual no iPhone:** tudo que depende do iOS, seguindo um checklist em `tasks/todo.md` por tarefa.
  - Login, áudio com a tela bloqueada, tela de bloqueio, offline, armazenamento, instalação.
- **Sem testes automatizados de interface ou de ponta a ponta na v1:** o comportamento que importa (iOS, tela bloqueada) só é verificável no aparelho.

## Limites

- **Sempre:**
  - Rodar `node --test` antes de cada commit.
  - Verificar no iPhone cada tarefa que toca o iOS.
  - Tratar erros de rede e de token (expirado, offline) sem perder dados locais.
  - Manter a interface utilizável sem internet.
- **Perguntar antes:**
  - Adicionar qualquer dependência.
  - Pedir qualquer escopo do Google além dos dois acima.
  - Mudar o formato do IndexedDB depois que já houver dados reais.
  - Publicar o repositório.
  - Qualquer coisa que apague downloads do usuário.
- **Nunca:**
  - Escrever, mover, renomear ou apagar arquivos no Drive do usuário (a única exceção é o `appDataFolder`).
  - Commitar tokens, client secret ou o ID da pasta.
  - Enviar dados do usuário para qualquer serviço além do Google.
  - Carregar scripts de CDN em tempo de execução.

## Critérios de sucesso

1. **Instalação:** pela Tela de Início, o app abre em tela cheia (`standalone`), inclusive sem internet (depois da primeira visita).
2. **Login:** o login com o Google lista a pasta `Músicas`, com subpastas, sem nenhuma etapa manual além de aceitar as permissões.
3. **Tela bloqueada:** um álbum de 3 faixas tocado pela internet segue até o fim com a tela bloqueada, e play/pause/próxima/anterior funcionam pela tela de bloqueio, com título e capa.
4. **Biblioteca:** artista, álbum e capa vêm das tags. Sem tag, vêm do nome do arquivo. Uma música nova adicionada ao Drive aparece depois de "Atualizar biblioteca".
5. **Offline:** uma playlist baixada toca inteira em modo avião, e as faixas não baixadas aparecem apagadas.
6. **Espaço:** o painel mostra o espaço usado pelos downloads, e apagar um download libera esse espaço.
7. **Backup:** depois de apagar os dados do app e entrar de novo, as playlists voltam do backup no Drive.
8. **Retomar:** fechar e reabrir o app volta à mesma música, ao mesmo ponto (±5 s) e à mesma fila.
9. **Drive intacto:** nenhuma chamada de escrita ao Drive fora do `appDataFolder` (conferido no código e na tela de permissões do Google).
10. **Testes:** `node --test` passa.

## Perguntas em aberto

1. **Biblioteca de tags:** é escolhida e aprovada na tarefa de `tags`.

As outras perguntas foram respondidas: login por popup; tempo até tocar aceitável no 4G; repositório `joaogabrielchiconi/player-musica`.
