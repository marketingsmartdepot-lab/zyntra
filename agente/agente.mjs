#!/usr/bin/env node
/**
 * Agente de impressão do ZYNTRA.
 *
 * Roda na máquina da bancada, ligada por USB na Zebra ZD220. Existe porque
 * navegador não fala com impressora USB e a ZD220 não tem rede — não há como
 * imprimir a partir do servidor.
 *
 * O que ele faz, em ciclo:
 *   1. bate ponto (é isso que faz a tela dizer "online")
 *   2. reserva os próximos trabalhos daquela impressora
 *   3. manda o ZPL para a impressora pelo spooler do sistema
 *   4. diz se o comando foi aceito
 *
 * O que ele NÃO faz: falar com o Mercado Livre. Quem busca a etiqueta é o
 * servidor, que tem o token. O agente recebe texto pronto — assim o segredo
 * nunca chega na máquina do galpão.
 *
 * E "impressa" aqui significa comando aceito pela impressora. A prova de que
 * saiu papel continua sendo o operador bipar a etiqueta impressa.
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";

const VERSAO = "agente 1.0";

const cfg = carregarConfig();
const ESPERA_MS = Number(cfg.INTERVALO_MS ?? 3000);

let parando = false;
for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => {
    parando = true;
    registrar("encerrando a pedido do sistema");
  });
}

registrar(`${VERSAO} iniciado em ${hostname()}`);
registrar(`impressora do sistema: ${cfg.IMPRESSORA}`);
registrar(`servidor: ${cfg.SUPABASE_URL}`);

while (!parando) {
  try {
    const trabalhos = await reservarTrabalhos();

    if (trabalhos.length === 0) {
      await dormir(ESPERA_MS);
      continue;
    }

    registrar(`${trabalhos.length} trabalho(s) para imprimir`);

    for (const t of trabalhos) {
      try {
        await imprimir(t.conteudo, t.copias ?? 1);
        await concluir(t.id, true);
        registrar(`ok  ${t.tipo}  ${t.id}`);
      } catch (erro) {
        const msg = erro instanceof Error ? erro.message : String(erro);
        await concluir(t.id, false, msg);
        registrar(`ERRO ${t.tipo} ${t.id}: ${msg}`);
      }
    }
  } catch (erro) {
    // Falha de rede não pode derrubar o agente: o galpão continua, e ele
    // volta a tentar no próximo ciclo.
    const msg = erro instanceof Error ? erro.message : String(erro);
    registrar(`ciclo falhou, tentando de novo: ${msg}`);
    await dormir(Math.max(ESPERA_MS, 5000));
  }
}

// ---------------------------------------------------------------- servidor

async function rpc(funcao, corpo) {
  const resposta = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${funcao}`, {
    method: "POST",
    headers: {
      apikey: cfg.SUPABASE_KEY,
      Authorization: `Bearer ${cfg.SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(corpo),
  });

  if (!resposta.ok) {
    throw new Error(`${funcao} respondeu ${resposta.status}`);
  }
  return resposta.json();
}

async function reservarTrabalhos() {
  const dados = await rpc("agente_reservar_trabalhos", {
    p_token: cfg.TOKEN,
    p_limite: 5,
  });
  return Array.isArray(dados) ? dados : [];
}

async function concluir(id, ok, erro) {
  await rpc("agente_concluir_trabalho", {
    p_token: cfg.TOKEN,
    p_impressao_id: id,
    p_ok: ok,
    p_erro: erro ?? null,
  });
}

// -------------------------------------------------------------- impressora

/**
 * O ZPL vai cru para o spooler. No macOS e Linux é `lp -o raw`; no Windows é
 * cópia binária para a impressora compartilhada, porque o spooler do Windows
 * não tem modo raw por linha de comando.
 */
async function imprimir(zpl, copias) {
  if (!zpl || !zpl.trim()) {
    throw new Error("trabalho sem conteúdo ZPL");
  }

  for (let i = 0; i < copias; i++) {
    if (process.platform === "win32") {
      await imprimirWindows(zpl);
    } else {
      await imprimirUnix(zpl);
    }
  }
}

function imprimirUnix(zpl) {
  return new Promise((resolve, reject) => {
    const p = spawn("lp", ["-d", cfg.IMPRESSORA, "-o", "raw"], {
      stdio: ["pipe", "ignore", "pipe"],
    });

    let erro = "";
    p.stderr.on("data", (d) => (erro += d.toString()));
    p.on("error", (e) => reject(new Error(`lp não pôde ser executado: ${e.message}`)));
    p.on("close", (codigo) =>
      codigo === 0
        ? resolve()
        : reject(new Error(erro.trim() || `lp terminou com código ${codigo}`)),
    );

    p.stdin.end(zpl);
  });
}

function imprimirWindows(zpl) {
  // O nome no Windows é o COMPARTILHAMENTO da impressora, não o nome amigável.
  const alvo = cfg.IMPRESSORA.startsWith("\\\\")
    ? cfg.IMPRESSORA
    : `\\\\${hostname()}\\${cfg.IMPRESSORA}`;
  const arquivo = join(tmpdir(), `zyntra-${Date.now()}.zpl`);

  writeFileSync(arquivo, zpl, "latin1");

  return new Promise((resolve, reject) => {
    const p = spawn("cmd", ["/c", "copy", "/B", arquivo, alvo], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let erro = "";
    p.stderr.on("data", (d) => (erro += d.toString()));
    p.on("error", (e) => reject(new Error(`copy falhou: ${e.message}`)));
    p.on("close", (codigo) => {
      try {
        unlinkSync(arquivo);
      } catch {
        // Arquivo temporário não removido não é motivo para falhar o trabalho.
      }
      codigo === 0
        ? resolve()
        : reject(
            new Error(
              erro.trim() ||
                `copy terminou com código ${codigo}. A impressora precisa estar compartilhada como "${cfg.IMPRESSORA}".`,
            ),
          );
    });
  });
}

// ------------------------------------------------------------------ apoio

function carregarConfig() {
  const arquivo = process.env.ZYNTRA_ENV ?? join(process.cwd(), ".env");
  const lido = {};

  try {
    for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
      const limpa = linha.trim();
      if (!limpa || limpa.startsWith("#")) continue;
      const i = limpa.indexOf("=");
      if (i > 0) lido[limpa.slice(0, i).trim()] = limpa.slice(i + 1).trim();
    }
  } catch {
    // Sem arquivo, vale o ambiente.
  }

  const cfg = { ...lido, ...semVazios(process.env) };
  const faltando = ["SUPABASE_URL", "SUPABASE_KEY", "TOKEN", "IMPRESSORA"].filter(
    (c) => !cfg[c],
  );

  if (faltando.length > 0) {
    console.error(
      `\nFalta configurar: ${faltando.join(", ")}\n` +
        `Copie .env.exemplo para .env e preencha. O TOKEN é gerado no ZYNTRA,\n` +
        `em Integração → Estações e impressoras, e aparece uma vez só.\n`,
    );
    process.exit(1);
  }

  return cfg;
}

function semVazios(obj) {
  const saida = {};
  for (const [k, v] of Object.entries(obj)) if (v) saida[k] = v;
  return saida;
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function registrar(msg) {
  const agora = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  console.log(`[${agora}] ${msg}`);
}
