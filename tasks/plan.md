# Plano de implementação: Player de Música

## Visão geral

PWA pessoal para iPhone que lê a pasta `Músicas` do Google Drive: toca pela internet, baixa o que for escolhido para ouvir offline e tem playlists com backup no Drive. A spec completa está em [`../SPEC.md`](../SPEC.md). As tarefas detalhadas estão em [`todo.md`](todo.md).

## Decisões de arquitetura

- **Protótipo antes de tudo.** O que pode inviabilizar o PWA está no iOS: login no app instalado, próxima faixa com a tela bloqueada e demora para começar a tocar. A Tarefa 1 testa só isso, com código descartável. Se falhar, voltamos à decisão da plataforma antes de escrever o resto.
- **Um só caminho de reprodução.** O áudio sempre toca a partir de um Blob, venha ele do IndexedDB (baixado) ou da memória (internet). O offline não cria outro player.
- **Lógica pura separada.** Fila, agrupamento, diferença com o Drive, nome do arquivo e serialização são funções puras testadas com `node --test`. O que depende do iOS é testado no aparelho.
- **Fatias verticais.** Cada tarefa entrega algo usável no iPhone. O visual definitivo fica para a Fase 6. Até lá, as telas são funcionais e simples.
- **Sem build.** Os arquivos publicados no Pages são os mesmos do repositório.

## Grafo de dependências

```
contas (T0)
  └─ protótipo (T1) ── go/no-go
       ├─ db (T2) ──────────────┐
       ├─ auth + drive (T3) ────┤
       └─ tags (T4) ────────────┤
                                ├─ sincronizar biblioteca (T5)
                                │    └─ listas e busca (T6)
                                │         └─ player completo (T7)
                                │              └─ retomar (T8)
                                │                   ├─ app offline (T9)
                                │                   │    └─ downloads e espaço (T10)
                                │                   └─ playlists (T11)
                                │                        └─ backup (T12) ← também T10 (baixar playlist)
                                └──────────────────────── design (T13) → finalização (T14)
```

## Lista de tarefas

### Fase 0: Contas e protótipo de risco
- [ ] T0: Contas, repositório e credencial Google
- [ ] T1: Protótipo: login, listar pasta, 3 faixas com tela bloqueada

**Checkpoint: Go/no-go.** Os critérios 2 e 3 da spec passam no iPhone com o app instalado. Você decide se seguimos com o PWA.

### Fase 1: Fundação
- [ ] T2: Banco local (IndexedDB)
- [ ] T3: Login e Drive definitivos
- [ ] T4: Leitura de tags

**Checkpoint:** `node --test` passa; quando o token vence, o app pede "Entrar" sem quebrar nem perder dados.

### Fase 2: Biblioteca
- [ ] T5: Sincronizar a biblioteca com o Drive
- [ ] T6: Abas Músicas, Artistas e Álbuns, com busca

### Fase 3: Player
- [ ] T7: Player completo, com mini player e tela cheia
- [ ] T8: Continuar de onde parou

**Checkpoint:** os critérios 2, 3, 4 e 8 da spec passam no iPhone. Revisão com você.

### Fase 4: Offline
- [ ] T9: App abre sem internet e faixas não baixadas ficam apagadas
- [ ] T10: Baixar, apagar, aba Baixadas e painel de espaço

### Fase 5: Playlists
- [ ] T11: Playlists: criar, editar, ordenar, tocar e baixar
- [ ] T12: Backup e restauração das playlists no Drive

**Checkpoint:** os critérios 5, 6 e 7 da spec passam no iPhone em modo avião.

### Fase 6: Acabamento
- [ ] T13: Design das telas com `impeccable`
- [ ] T14: Ícones, acessibilidade, revisão de segurança e checklist final

**Checkpoint final:** os 10 critérios de sucesso da spec foram verificados.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| O iOS pausa o PWA com a tela bloqueada e a próxima faixa não começa | Alto | T1 testa primeiro. Pré-carregar a próxima faixa enquanto a atual toca. Se falhar, reavaliar a plataforma (app nativo ou VLC). |
| O login por popup falha no app instalado | Alto | T1 testa popup e redirecionamento, e fica o que funcionar. |
| Baixar a faixa inteira antes de tocar demora demais no 4G | Médio | T1 mede. Acima de ~5 s, criar uma tarefa de streaming com Range via service worker. |
| O iOS apaga os dados do app (downloads e playlists) | Médio | `navigator.storage.persist()`, backup das playlists no Drive (T12) e app instalado na Tela de Início (fica fora da limpeza de 7 dias). |
| Token expira no meio da sincronização ou de um download | Médio | `drive.js` repete a chamada uma vez depois de renovar. A sincronização é idempotente e pode ser retomada. |
| Leitor de tags próprio não cobre algum arquivo raro | Baixo | Cai no nome do arquivo. Testes cobrem ID3v2.2/2.3/2.4, UTF-16 e capa grande. |
| M4A com metadados no fim do arquivo fica sem tags | Baixo | Usar o nome do arquivo. Se incomodar, ler também o fim do arquivo. |

## Perguntas em aberto

- Nome do repositório. A sugestão é `player-musica`, que fica em `https://<usuario>.github.io/player-musica/`. Isso é confirmado na T0.
