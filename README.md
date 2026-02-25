# Agente Visual com Playwright e Claude

Agente de testes automatizados que usa visão computacional para navegar em interfaces web.

## Como funciona

1. Tira um screenshot da tela com Playwright
2. Envia o screenshot para a API da Anthropic (Claude)
3. Claude analisa a imagem e retorna a próxima ação em JSON (`click`, `type` ou `done`)
4. O agente executa a ação no browser e repete até concluir a tarefa

## Scripts

- **`agente.js`** — agente em loop: abre o Google, pesquisa "Playwright testes automatizados" e encerra quando os resultados aparecem
- **`screenshot.js`** — tira um screenshot simples do google.com e salva como `screenshot.png`

## Instalação

```bash
npm install
npx playwright install chromium
```

## Configuração

Crie um arquivo `.env` na raiz do projeto:

```
ANTHROPIC_API_KEY=sua-chave-aqui
```

## Uso

```bash
node agente.js
```

## Tecnologias

- [Playwright](https://playwright.dev/) — automação de browser
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-node) — API do Claude
- [dotenv](https://github.com/motdotla/dotenv) — variáveis de ambiente
