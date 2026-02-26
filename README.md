# Visual Testing Agent

Agente de testes visuais automatizados que usa visão computacional para navegar e validar qualquer aplicação web, sem depender de seletores ou estrutura interna do DOM.

## Como funciona

1. Tira um screenshot da tela com Playwright
2. Envia o screenshot para a API da Anthropic (Claude)
3. Claude analisa a imagem e retorna a próxima ação em JSON (`click`, `type`, `done` ou `fail`)
4. O agente executa a ação no browser e repete até concluir o cenário
5. Ao final, reporta quais cenários passaram e quais falharam

## Cenários

Os cenários de teste são arquivos JSON na pasta `cenarios/`. Cada arquivo define um teste independente:

```json
{
  "nome": "nome-do-cenario",
  "instrucao": "Descreva em linguagem natural o que o agente deve fazer e como confirmar sucesso."
}
```

O agente lê todos os arquivos `.json` da pasta, executa cada um em sequência e exibe um relatório ao final. Se qualquer cenário falhar, o processo termina com exit code `1`.

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

Exemplo de saída:

```
Encontrados 2 cenário(s): meu-cenario-a, meu-cenario-b

==================================================
CENÁRIO: meu-cenario-a
==================================================
...

==================================================
RELATÓRIO FINAL
==================================================
  [PASSOU] meu-cenario-a: Concluído com sucesso.
  [PASSOU] meu-cenario-b: Concluído com sucesso.

Todos os cenários passaram!
```

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `ANTHROPIC_API_KEY` | Chave de acesso à API da Anthropic |
| `CI` | Quando `true`, executa o browser em modo headless |

## Tecnologias

- [Playwright](https://playwright.dev/) — automação de browser
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-node) — API do Claude
- [dotenv](https://github.com/motdotla/dotenv) — variáveis de ambiente
