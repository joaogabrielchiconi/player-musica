# Credencial do Google (fazer uma vez)

Leva uns 10 minutos. Use a **mesma conta Google da pasta `Músicas`** em todos os passos.

## 1. Criar o projeto

1. Abra <https://console.cloud.google.com/> e entre com a sua conta.
2. No seletor de projetos (topo da tela), clique em **Novo projeto**.
3. Nome: `Player de Musica`. Clique em **Criar** e, quando terminar, selecione o projeto.

## 2. Ativar a API do Drive

1. Abra <https://console.cloud.google.com/apis/library/drive.googleapis.com>.
2. Confira se o projeto selecionado é o `Player de Musica` e clique em **Ativar**.

## 3. Configurar a tela de consentimento

1. Abra <https://console.cloud.google.com/auth/overview> e clique em **Começar**.
2. **Informações do app:**
   - Nome do app: `Player de Música`.
   - E-mail de suporte: o seu.
3. **Público-alvo:** escolha **Externo**.
4. **Dados de contato:** o seu e-mail.
5. Aceite a política e clique em **Criar**.

## 4. Cadastrar você como usuário de teste

1. Menu lateral, **Público-alvo**.
2. Deixe o status em **Teste**. Não publique.
3. Em **Usuários de teste**, clique em **Adicionar usuários**, coloque o seu e-mail e salve.

## 5. Escolher as permissões

1. Menu lateral, **Acesso a dados**. Clique em **Adicionar ou remover escopos**.
2. Marque estes dois. Se não aparecerem na lista, cole cada um no campo de escopo manual:
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/drive.appdata`
3. Clique em **Atualizar** e depois em **Salvar**.

O aviso de "escopo restrito" é normal. Ele só pesa para apps públicos; o seu fica em teste.

## 6. Criar o Client ID

1. Menu lateral, **Clientes**. Clique em **Criar cliente**.
2. Tipo de aplicativo: **Aplicativo da Web**. Nome: `Player PWA`.
3. Em **Origens JavaScript autorizadas**, adicione:
   - `https://joaogabrielchiconi.github.io`
   - `http://localhost:5173`
4. Em **URIs de redirecionamento autorizados**, adicione:
   - `https://joaogabrielchiconi.github.io/player-musica/`
   - `https://joaogabrielchiconi.github.io/player-musica/proto/`
5. Clique em **Criar**.

## 7. Me passar o Client ID

Copie o **ID do cliente**: termina em `.apps.googleusercontent.com`. Cole no chat do Claude.

> **Não cole a "Chave secreta do cliente"** (client secret), nem no chat nem em lugar nenhum. O app não usa essa chave. O Client ID, ao contrário, pode ficar público.

## Ao entrar no app pela primeira vez

O Google vai mostrar **"O Google não verificou este app"**. É esperado, porque o app é seu e está em teste. Clique em **Continuar** e aceite as duas permissões.
