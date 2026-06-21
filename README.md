# Vanguard Launcher

Launcher de jogo estilo tático, feito com **Electron + Node.js**, inspirado no layout que você enviou (sidebar de navegação, hero principal com botão "JOGAR", grade de notícias, atalhos rápidos e painel lateral com perfil/amigos/loja).

> Observação: usei uma marca e ilustrações próprias (não as artes/logotipo do Counter-Strike 2), para não reproduzir material protegido por direitos autorais — mas a estrutura, cores e proporções seguem fielmente a referência.

## Estrutura

```
launcher/
├── package.json
├── main.js          → processo principal do Electron (janela, botões de minimizar/maximizar/fechar, IPC)
├── preload.js        → ponte segura entre main e renderer (contextIsolation)
└── src/
    ├── index.html     → estrutura da interface
    ├── style.css       → tema escuro + laranja, layout em grid
    └── renderer.js   → interações (navegação, botão jogar, overlay de carregamento)
```

## Como rodar

1. Tenha o [Node.js](https://nodejs.org) instalado (versão 18+).
2. Abra um terminal dentro da pasta `launcher`.
3. Instale as dependências:

   ```bash
   npm install
   ```

4. Rode o launcher:

   ```bash
   npm start
   ```

Uma janela sem moldura (frameless) deve abrir com o layout completo.

## Personalizando

- **Trocar o nome/marca**: edite `<span class="brand-name">` e `.hero-title` em `src/index.html`.
- **Trocar cores**: todas as cores estão centralizadas em variáveis CSS no topo de `src/style.css` (`:root { --orange: ...; --bg: ...; }`).
- **Botão JOGAR de verdade**: em `main.js`, dentro do handler `ipcMain.on('launch-game', ...)`, troque o `setTimeout` simulado por algo como:

  ```js
  const { exec } = require('child_process');
  exec('"C:\\Caminho\\Para\\Jogo.exe"');
  ```

- **Imagens reais**: para usar fotos/artes de verdade no hero (em vez do SVG ilustrativo), coloque o arquivo em `src/assets/` e troque o `<svg class="hero-art">` por uma `<img>` ou um `background-image` no CSS.
- **Itens da sidebar / notícias / amigos**: são todos HTML estático em `index.html` — fácil de transformar em dados dinâmicos (ex: carregando de uma API ou arquivo JSON) se quiser deixar mais "real".

## Discord Rich Presence

O launcher já vem com **Rich Presence do Discord** integrado: quando o cliente abre, seu status no Discord passa a mostrar algo como "Vanguard 2 Launcher — No menu principal", e quando o jogo é "lançado", muda para "Em partida — Competitivo".

### Passo a passo para ativar

1. Acesse **https://discord.com/developers/applications** e clique em **New Application**. Dê um nome (ex: `Vanguard 2`).
2. Na página da aplicação, copie o **Application ID** (é o seu `CLIENT_ID`).
3. Abra `discord-rpc.js` e substitua:

   ```js
   const CLIENT_ID = process.env.DISCORD_CLIENT_ID || 'SEU_CLIENT_ID_AQUI';
   ```

   pelo ID copiado — ou defina a variável de ambiente `DISCORD_CLIENT_ID` antes de rodar o launcher.

4. (Opcional, mas recomendado) Na mesma página da aplicação, vá em **Rich Presence → Art Assets** e suba duas imagens:
   - uma "grande" (ex: logo do jogo) com o nome `logo_grande`
   - uma "pequena" (ex: ícone de status) com o nome `icone_menu` e outra `icone_jogando`

   Esses nomes precisam ser **exatamente iguais** às chaves usadas em `discord-rpc.js` (`largeImageKey`, `smallImageKey`). Sem isso, o Rich Presence ainda funciona, só aparece sem imagem.

5. Rode o launcher normalmente (`npm start`). Com o **Discord desktop aberto** no PC, o status deve aparecer no seu perfil em poucos segundos.

### Como funciona

- `discord-rpc.js` é um módulo isolado que conecta ao Discord via IPC local (não precisa de internet, só do app do Discord rodando na mesma máquina).
- `main.js` chama `discordRPC.connect()` quando o app abre, `setMenuActivity()` quando está parado no menu, e `setPlayingActivity()` quando o botão **JOGAR** é usado.
- Se o Discord não estiver aberto, o módulo tenta reconectar automaticamente a cada 10-15s — então se o usuário abrir o Discord depois do launcher, o status aparece sozinho.

### Personalizando o texto do status

Edite as funções `setMenuActivity()` e `setPlayingActivity()` em `discord-rpc.js`:

```js
client.user?.setActivity({
  details: 'No menu principal',     // linha 1 do status
  state: 'Vanguard 2 Launcher',     // linha 2 do status
  startTimestamp,                    // mostra "há X minutos"
  largeImageKey: 'logo_grande',
  largeImageText: 'Vanguard 2',      // tooltip ao passar o mouse na imagem grande
  smallImageKey: 'icone_menu',
  smallImageText: 'No menu',
});
```

## Auto Update (atualização automática)

O launcher já vem com **`electron-updater`** integrado: quando abre, ele confere se existe uma versão mais nova publicada, baixa em segundo plano e mostra uma barra no topo perguntando se você quer reiniciar e instalar.

> ⚠️ **Importante**: auto-update **só funciona no app empacotado** (instalado via `.exe`/`.dmg`/`.AppImage`). Em modo dev (`npm start` / `electron .`) ele é ignorado de propósito — você vai ver `[AutoUpdate] Ignorado: app não está empacotado` no terminal, e isso é esperado.

### Como funciona

1. App abre → `autoUpdate.checkForUpdates()`
2. Se existe versão nova → baixa automaticamente
3. Quando termina → mostra a barra "Atualização X.X.X baixada e pronta para instalar" com o botão **REINICIAR E ATUALIZAR**
4. Usuário clica → o app fecha e reabre já atualizado

### Onde publicar as versões

Por padrão, o `package.json` está configurado para publicar no **GitHub Releases** (é a opção mais simples e gratuita). Edite essa parte com o seu usuário/repositório:

```json
"publish": {
  "provider": "github",
  "owner": "SEU_USUARIO_GITHUB",
  "repo": "SEU_REPOSITORIO"
}
```

**Alternativas**, caso não queira usar GitHub:

```json
// Servidor próprio (qualquer host estático que sirva arquivos)
"publish": {
  "provider": "generic",
  "url": "https://seu-dominio.com/downloads/"
}
```

```json
// Amazon S3
"publish": {
  "provider": "s3",
  "bucket": "seu-bucket"
}
```

### Como lançar uma nova versão (fluxo no GitHub)

1. Suba seu código pra um repositório no GitHub (pode ser privado, mas você vai precisar de um [token de acesso pessoal](https://github.com/settings/tokens) com permissão `repo`).
2. Defina a variável de ambiente `GH_TOKEN` com esse token antes de buildar:

   ```bash
   # Windows (PowerShell)
   $env:GH_TOKEN="seu_token_aqui"

   # Mac/Linux
   export GH_TOKEN="seu_token_aqui"
   ```

3. Atualize a versão no `package.json` (ex: `"version": "1.0.1"`).
4. Rode:

   ```bash
   npm run dist -- --publish always
   ```

   Isso gera o instalador **e** já cria/atualiza um Release no GitHub com os arquivos certos (`latest.yml`, o instalador, etc. — o `electron-updater` precisa desses arquivos de metadado pra saber que tem uma versão nova).

5. Quem já tem o launcher instalado (versão anterior) vai receber a atualização automaticamente na próxima vez que abrir o app.

### Testando sem publicar de verdade (provider `generic`)

Se quiser testar localmente antes de usar GitHub:

1. Troque o `publish` pra `generic` apontando pra uma pasta servida localmente (ex: `http://localhost:8080/`).
2. Rode `npm run dist` (sem `--publish`) — isso gera os arquivos em `dist/`, incluindo o `latest.yml`.
3. Sirva essa pasta `dist/` com qualquer servidor estático (`npx serve dist`).
4. Instale a versão **anterior** do app, suba a versão no `package.json`, gere o build de novo, e abra o app antigo — ele deve detectar e baixar a nova versão do seu servidor local.

### Assinatura de código (code signing)

Em produção, Windows e macOS recomendam (e o macOS praticamente exige) que o instalador seja **assinado digitalmente**, ou o usuário vai ver avisos de "app não confiável" / o auto-update pode falhar silenciosamente no Mac sem assinatura. Isso é opcional pra testar, mas vale considerar antes de distribuir pra outras pessoas — procure por "electron-builder code signing" quando chegar nessa etapa.

## Empacotar como instalável (.exe / .dmg / .AppImage)

O `electron-builder` já está incluído no projeto e configurado em `package.json` (seção `build`). Pra gerar o instalável:

```bash
npm run dist
```

Os arquivos finais aparecem na pasta `dist/`. Se quiser publicar direto (auto-update), use `npm run dist -- --publish always` — veja a seção **Auto Update** acima.
