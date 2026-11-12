# Design: Músicas (fita cassete)

Escrito a partir do que foi construído (T13). Fonte da verdade dos valores: `css/app.css` (`:root`).

## Mundo

Uma coleção pessoal de fitas K7: as músicas do dono, numeradas como num inlay, uma fita tocando. Tema escuro (uso à noite, no carro, com o celular na mão). Tela de trabalho (modo Operar): o mundo entra por cor, tipo, densidade e um detalhe de assinatura; a navegação e os controles são os padrões de qualquer player.

## Cor

Estratégia: comprometida. Azul-fita escuro no fundo, laranja para o que toca e para a ação principal, amarelo só para estado de download.

| Papel | Token | Valor |
|---|---|---|
| Fundo | `--bg` | `#0E1626` |
| Superfície (campos, capa vazia) | `--surface` | `#17233B` |
| Elevada (mini player, botões, linha tocando) | `--raised` | `#1C2C4D` |
| Borda de objetos | `--edge` | `#2B3C63` |
| Divisor de lista | `--line` | `#1B2A47` |
| Texto | `--ink` | `#F1ECE0` |
| Texto secundário | `--muted` | `#9AA6C0` |
| Fita (tocando, ação principal, foco) | `--orange` | `#FF6B2C` |
| Texto sobre laranja | `--on-orange` | `#0E1626` |
| Baixada, na fila, aviso | `--yellow` | `#F4D03F` |
| Apagar | `--danger` | `#FF8A80` |

Contrastes medidos: texto/fundo 15,3; secundário/fundo 7,4 e /elevada 5,7; laranja/fundo 6,4 e /elevada 4,9; texto sobre laranja 6,4; amarelo/fundo 12,0.

Etiquetas de playlist (a mesma playlist sempre ganha a mesma cor): `#F4D03F #FF6B2C #5CC8B5 #F28DB2 #9B8CFF #8FD16B`, com tinta escura por cima.

## Tipo

Só fontes do sistema (o app abre sem internet). Interface em SF Pro (`-apple-system`); números e medidas (número da faixa, tempo, porcentagem, contagem) em SF Mono com algarismos tabulares. Título da tela 34 px peso 800, entrelinha 1,1, no máximo 2 linhas. Corpo 16 px; metadados 13 px; campos 16 px (o iOS não dá zoom ao focar).

## Forma e profundidade

Cantos: botões e campos 12 px, mini player 16 px, folhas 20 px, etiqueta de contagem 3 px (inclinada 2°). Sombras com deslocamento e desfoque (mini player, toast, diálogos, fita); nenhuma sombra dura nem brilho.

## Assinatura: a fita

O progresso da música é a fita passando de um carretel para o outro: o carretel da esquerda esvazia e o da direita enche (`--p` de 0 a 1 escala os dois discos), no mini player e na fita grande do player em tela cheia. Os miolos giram só enquanto toca (mais rápido enquanto carrega). Sem capa nas tags, a fita desenhada ocupa o lugar da capa (a etiqueta mostra o álbum); com capa, a capa aparece no lugar da fita. Playlists são "fitas": etiqueta colorida com duas linhas na lista.

## Componentes

- **Linha de música:** título (600), artista · álbum, botão de baixar e botão +. Tocando: fundo elevado, título laranja e três barrinhas no canto (só se mexem enquanto toca). Sem internet e não baixada: opacidade .45. Lista numerada (álbum, playlist) mostra o número em mono.
- **Download:** ícone baixar, três pontos na fila, porcentagem em mono enquanto baixa, check amarelo quando baixada.
- **Botões:** `.btn` (44 px, elevado), `.btn.primary` (laranja), `.btn.danger`; `.icon-btn` 44 x 44.
- **Abas:** cinco, texto de 13 px; a ativa fica laranja com um traço de 3 px no topo.
- **Mini player:** cartão elevado fixo acima das abas, com os dois carretéis, título, tocar/pausar e próxima.
- **Player em tela cheia:** fita, título, barra de posição (trilha laranja), tempos em mono, aleatório, anterior, tocar (círculo laranja de 72 px), próxima, repetir, fila.
- **Diálogos:** `<dialog>` modal para nome de playlist e confirmações; folha de baixo para "adicionar à playlist".
- **Ícones:** desenhados, traço de 2 px com pontas redondas, em um sprite no `index.html`.

## Estados

Vazio (biblioteca, busca, baixadas, playlists) com o ícone de fita e uma frase de ação. Sincronizando: ícone de atualizar girando e barra fina no cabeçalho. Sem internet: etiqueta "sem internet" no título e músicas não baixadas apagadas. Login vencido e erros: texto na linha de status. Movimento reduzido: sem animações.

## Medidas de verificação

Alvos de toque de 44 pt em todas as telas (conferido por código nas cinco abas, no álbum e nos diálogos). Área segura do iPhone respeitada no topo, no mini player/abas e no player em tela cheia. Sem barra colorida lateral em itens de lista, sem texto em gradiente, sem emoji ou glifos no lugar de ícones.
