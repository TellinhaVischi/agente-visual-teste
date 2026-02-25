require('dotenv').config();
const { chromium } = require('playwright');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const client = new Anthropic();
const MAX_STEPS = 15;

function buildPrompt(history) {
  const goal =
    "Você é um agente de testes automatizados. Sua tarefa é pesquisar " +
    "'Playwright testes automatizados' no Google e confirmar que os resultados apareceram.";

  const historyText =
    history.length === 0
      ? 'Nenhuma ação realizada ainda.'
      : history
          .map((h, i) => `  Step ${i + 1}: ${JSON.stringify(h)}`)
          .join('\n');

  return (
    goal +
    '\n\nAções já realizadas:\n' +
    historyText +
    '\n\nOlhe o screenshot atual e diga qual é a PRÓXIMA ação a executar. ' +
    'Se a barra de pesquisa já estiver focada (com cursor ou dropdown aberto), use "type" para digitar. ' +
    'Se o texto já foi digitado, use "type" com "Enter" para confirmar. ' +
    'Se os resultados da pesquisa já aparecerem na tela, retorne "done". ' +
    'Responda APENAS com JSON válido, sem markdown: ' +
    '{"action": "click|type|done", "x": number, "y": number, "text": string, "reason": string}'
  );
}

async function takeScreenshot(page, step) {
  const path = `screenshot_step${step}.png`;
  await page.screenshot({ path });
  return path;
}

async function askClaude(imagePath, history) {
  const imageData = fs.readFileSync(imagePath).toString('base64');
  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: imageData },
          },
          { type: 'text', text: buildPrompt(history) },
        ],
      },
    ],
  });
  return response.content[0].text;
}

function parseAction(raw) {
  // Extrai todos os blocos {...} e retorna o último JSON válido
  let lastValid = null;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (raw[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          lastValid = JSON.parse(raw.slice(start, i + 1));
        } catch (_) {}
        start = -1;
      }
    }
  }

  if (!lastValid) throw new Error(`JSON válido não encontrado: ${raw}`);
  return lastValid;
}

async function executeAction(page, action) {
  if (action.action === 'click') {
    await page.mouse.click(action.x, action.y);
  } else if (action.action === 'type') {
    const isEnter = ['Enter', '\n', '\r\n', '\\n'].includes(action.text);
    if (isEnter) {
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.type(action.text);
    }
  }
  await page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  console.log('Abrindo google.com...');
  await page.goto('https://www.google.com');
  await page.waitForTimeout(1000);

  const history = [];

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`\n=== Step ${step}/${MAX_STEPS} ===`);

    const screenshotPath = await takeScreenshot(page, step);
    console.log(`Screenshot: ${screenshotPath}`);

    console.log('Perguntando ao Claude...');
    const raw = await askClaude(screenshotPath, history);
    console.log(`Resposta: ${raw}`);

    let action;
    try {
      action = parseAction(raw);
    } catch (e) {
      console.error(`Erro ao parsear JSON: ${e.message}`);
      break;
    }

    console.log(`Ação: ${action.action} | Motivo: ${action.reason}`);

    if (action.action === 'done') {
      console.log('\nConcluído! Pesquisa realizada com sucesso.');
      await takeScreenshot(page, `${step}_final`);
      break;
    }

    if (action.action === 'click') {
      console.log(`Clicando em (${action.x}, ${action.y})`);
    } else if (action.action === 'type') {
      console.log(`Digitando: "${action.text}"`);
    }

    history.push({ action: action.action, x: action.x, y: action.y, text: action.text, reason: action.reason });

    await executeAction(page, action);

    if (step === MAX_STEPS) {
      console.log('\nLimite de steps atingido.');
    }
  }

  await context.close();
  await browser.close();
})();
