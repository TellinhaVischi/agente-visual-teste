require('dotenv').config();
const { chromium } = require('playwright');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();
const MAX_STEPS = 15;

function buildPrompt(instrucao, history) {
  const historyText =
    history.length === 0
      ? 'Nenhuma ação realizada ainda.'
      : history
          .map((h, i) => `  Step ${i + 1}: ${JSON.stringify(h)}`)
          .join('\n');

  return (
    instrucao +
    '\n\nAções já realizadas:\n' +
    historyText +
    '\n\nOlhe o screenshot atual e diga qual é a PRÓXIMA ação a executar. ' +
    'Se a barra de pesquisa já estiver focada (com cursor ou dropdown aberto), use "type" para digitar. ' +
    'Se o texto já foi digitado, use "type" com "Enter" para confirmar. ' +
    'Se os resultados da pesquisa já aparecerem na tela, retorne "done". ' +
    'Se detectar um erro irrecuperável na tela (CAPTCHA, página de erro, bloqueio), retorne "fail". ' +
    'Responda APENAS com JSON válido, sem markdown: ' +
    '{"action": "click|type|done|fail", "x": number, "y": number, "text": string, "reason": string}'
  );
}

async function takeScreenshot(page, scenarioName, step) {
  const safe = scenarioName.replace(/[^a-z0-9_-]/gi, '_');
  const filePath = `screenshot_${safe}_step${step}.png`;
  await page.screenshot({ path: filePath });
  return filePath;
}

async function askClaude(imagePath, instrucao, history) {
  const imageData = fs.readFileSync(imagePath).toString('base64');
  const MAX_RETRIES = 4;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
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
              { type: 'text', text: buildPrompt(instrucao, history) },
            ],
          },
        ],
      });
      return response.content[0].text;
    } catch (e) {
      const isOverloaded = e.status === 529 || (e.message && e.message.includes('overloaded'));
      if (isOverloaded && attempt < MAX_RETRIES) {
        const waitMs = attempt * 5000;
        console.log(`API sobrecarregada. Tentativa ${attempt}/${MAX_RETRIES - 1}, aguardando ${waitMs / 1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw e;
    }
  }
}

function parseAction(raw) {
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

async function runScenario(browser, scenario) {
  const { nome, instrucao, url = 'https://www.google.com' } = scenario;
  const safe = nome.replace(/[^a-z0-9_-]/gi, '_');
  const videoTarget = `videos/${safe}.webm`;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`CENÁRIO: ${nome}`);
  console.log('='.repeat(50));

  let context;
  let page;

  async function closeContext() {
    if (!context) return;
    const video = page && page.video();
    await context.close();
    if (video) {
      try {
        const tmpPath = await video.path();
        fs.renameSync(tmpPath, videoTarget);
        console.log(`Vídeo salvo: ${videoTarget}`);
      } catch (_) {}
    }
  }

  try {
    context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: 'videos/', size: { width: 1280, height: 720 } },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    page = await context.newPage();

    console.log(`Abrindo ${url}...`);
    await page.goto(url);
    await page.waitForTimeout(1500);

    const history = [];
    let concluded = false;

    for (let step = 1; step <= MAX_STEPS; step++) {
      console.log(`\n--- Step ${step}/${MAX_STEPS} ---`);

      const screenshotPath = await takeScreenshot(page, nome, step);
      console.log(`Screenshot: ${screenshotPath}`);

      console.log('Perguntando ao Claude...');
      const raw = await askClaude(screenshotPath, instrucao, history);
      console.log(`Resposta: ${raw}`);

      let action;
      try {
        action = parseAction(raw);
      } catch (e) {
        await closeContext();
        return { passed: false, reason: `Erro ao parsear JSON: ${e.message}` };
      }

      console.log(`Ação: ${action.action} | Motivo: ${action.reason}`);

      if (action.action === 'done') {
        console.log(`\nCenário "${nome}" concluído com sucesso.`);
        await takeScreenshot(page, nome, `${step}_final`);
        concluded = true;
        break;
      }

      if (action.action === 'fail') {
        await takeScreenshot(page, nome, `${step}_fail`);
        await closeContext();
        return { passed: false, reason: `Claude declarou falha: ${action.reason}` };
      }

      if (action.action === 'click') {
        console.log(`Clicando em (${action.x}, ${action.y})`);
      } else if (action.action === 'type') {
        console.log(`Digitando: "${action.text}"`);
      }

      history.push({ action: action.action, x: action.x, y: action.y, text: action.text, reason: action.reason });

      await executeAction(page, action);
    }

    await closeContext();

    if (!concluded) {
      return { passed: false, reason: `Limite de ${MAX_STEPS} steps atingido sem concluir.` };
    }
    return { passed: true, reason: 'Concluído com sucesso.' };

  } catch (e) {
    await closeContext().catch(() => {});
    return { passed: false, reason: `Erro inesperado: ${e.message}` };
  }
}

(async () => {
  let browser;

  try {
    const scenariosDir = 'cenarios';
    if (!fs.existsSync(scenariosDir)) {
      console.error(`Pasta "${scenariosDir}" não encontrada.`);
      process.exit(1);
    }

    fs.mkdirSync('videos', { recursive: true });

    const scenarioFiles = fs
      .readdirSync(scenariosDir)
      .filter(f => f.endsWith('.json') && fs.statSync(path.join(scenariosDir, f)).isFile())
      .sort();

    if (scenarioFiles.length === 0) {
      console.error(`Nenhum cenário (.json) encontrado em "${scenariosDir}".`);
      process.exit(1);
    }

    const scenarios = scenarioFiles.map(f => {
      const raw = fs.readFileSync(path.join(scenariosDir, f), 'utf8');
      return JSON.parse(raw);
    });

    console.log(`Encontrados ${scenarios.length} cenário(s): ${scenarios.map(s => s.nome).join(', ')}`);

    const isCI = process.env.CI === 'true';
    browser = await chromium.launch({
      headless: isCI,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const results = [];
    for (const scenario of scenarios) {
      const result = await runScenario(browser, scenario);
      results.push({ nome: scenario.nome, ...result });
    }

    await browser.close();

    console.log(`\n${'='.repeat(50)}`);
    console.log('RELATÓRIO FINAL');
    console.log('='.repeat(50));
    for (const r of results) {
      const status = r.passed ? 'PASSOU' : 'FALHOU';
      console.log(`  [${status}] ${r.nome}: ${r.reason}`);
    }

    const failed = results.filter(r => !r.passed);
    if (failed.length > 0) {
      console.error(`\n${failed.length} cenário(s) falharam.`);
      process.exit(1);
    }

    console.log('\nTodos os cenários passaram!');

  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    console.error(`\nErro inesperado: ${e.message}`);
    process.exit(1);
  }
})();
