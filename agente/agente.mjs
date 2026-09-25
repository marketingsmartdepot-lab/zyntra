#!/usr/bin/env node
/**
 * Agente de impressão do ZYNTRA.
 *
 * Roda na máquina da bancada, ligada por USB na Zebra. Existe porque navegador
 * não fala com impressora USB e a ZD220 não tem rede — não há como imprimir a
 * partir do servidor.
 *
 * Na primeira vez ele pede o e-mail e a senha de quem usa o ZYNTRA. Com isso
 * registra a máquina e recebe uma credencial do DISPOSITIVO, que é o que fica
 * guardado daqui em diante. A senha não é gravada em lugar nenhum: se esta
 * máquina for trocada ou sumir, some a credencial dela e pronto — ninguém
 * precisa trocar de senha.
 *
 * Ele também manda a lista de impressoras que o sistema operacional enxerga.
 * Ninguém digita nome de impressora: nome digitado errado não imprime, e falha
 * calado.
 *
 * O que ele NÃO faz: falar com o Mercado Livre ou com o Bling. Quem busca a
 * etiqueta é o servidor, que tem as credenciais. O agente recebe texto pronto.
 *
 * E "impressa" aqui significa comando aceito pela impressora. A prova de que
 * saiu papel continua sendo o operador bipar a etiqueta impressa.
 */

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { tmpdir, hostname, platform, homedir } from "node:os";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const VERSAO = "agente 2.0";
const ESPERA_MS = 3000;

/** A credencial da máquina mora aqui, fora da pasta do programa. */
const ARQUIVO = process.env.ZYNTRA_CONFIG ?? join(homedir(), ".zyntra", "agente.json");

const SERVIDOR = process.env.ZYNTRA_URL ?? "https://jhgpqllkeqqeuqxxzzup.supabase.co";
const CHAVE =
  process.env.ZYNTRA_CHAVE ?? "sb_publishable_Nu82pRN47pqk_Ed2jC8WbQ_BxPgTVty";

let parando = false;
for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => {
    parando = true;
    registrar("encerrando a pedido do sistema");
  });
}

/**
 * A credencial da máquina, uma vez lida. Fica no módulo porque as funções que
 * falam com o servidor precisam dela, e passá-la por parâmetro em todas só
 * engrossaria as assinaturas.
 */
let cfg = null;

/**
 * Tudo dentro de uma função de propósito: `await` no topo do arquivo não
 * sobrevive ao empacotamento em executável, que exige CommonJS.
 */
async function principal() {
  // `--versao` existe para o instalador conferir que o executável abre, sem
  // precisar de credencial nem de rede.
  if (process.argv.includes("--versao")) {
    console.log(VERSAO);
    return 0;
  }

  registrar(`${VERSAO} em ${hostname()}`);

  cfg = (await lerConfig()) ?? (await primeiraVez());
  if (!cfg) return 1;

  await instalarSeNecessario().catch((e) =>
    registrar(`não consegui deixar o agente instalado: ${e.message}`),
  );

  // A lista de impressoras vai a cada início: impressora nova aparece na tela
  // do ZYNTRA sem ninguém reinstalar nada.
  await publicarImpressoras().catch((e) =>
    registrar(`não consegui enviar a lista de impressoras: ${e.message}`),
  );

  // `--registrar` faz só o login e sai. O instalador precisa disso: se ele
  // chamasse o agente normal para registrar a máquina, ficaria preso no laço
  // abaixo e a instalação nunca terminaria.
  if (process.argv.includes("--registrar")) {
    registrar("máquina registrada");
    return 0;
  }

  registrar("online — aguardando trabalhos");

  while (!parando) {
    try {
      const trabalhos = await rpc("agente_reservar_trabalhos", {
        p_token: cfg.token,
        p_limite: 5,
      });

      if (!Array.isArray(trabalhos) || trabalhos.length === 0) {
        await dormir(ESPERA_MS);
        continue;
      }

      for (const t of trabalhos) {
        try {
          await imprimir(t.impressora, t.conteudo, t.copias ?? 1, t.linguagem);
          await concluir(t.id, true);
          registrar(`ok   ${t.tipo}  ${t.impressora}  (${t.linguagem ?? "zpl"})`);
        } catch (erro) {
          const msg = erro instanceof Error ? erro.message : String(erro);
          await concluir(t.id, false, msg);
          registrar(`ERRO ${t.tipo}  ${t.impressora}: ${msg}`);
        }
      }
    } catch (erro) {
      // Falha de rede não pode derrubar o agente: o galpão continua, e ele
      // volta a tentar no próximo ciclo.
      registrar(`ciclo falhou, tentando de novo: ${erro.message}`);
      await dormir(Math.max(ESPERA_MS, 5000));
    }
  }

  return 0;
}

// ------------------------------------------------------------ primeira vez

/** O agente está rodando como executável, e não pelo código-fonte? */
async function empacotado() {
  try {
    const sea = await import("node:sea");
    return sea.isSea();
  } catch {
    return false;
  }
}

/**
 * Deixa o agente instalado, sem instalador.
 *
 * Ela baixa o .exe pelo ZYNTRA, abre, entra com e-mail e senha — e acabou. O
 * próprio agente se copia para a pasta do usuário e se agenda para abrir
 * quando alguém entrar no Windows. Rodar de novo o arquivo baixado atualiza a
 * cópia instalada; é assim que uma versão nova chega à bancada.
 *
 * Tarefa agendada, e não serviço do Windows: a credencial da máquina mora na
 * pasta do usuário, e serviço roda como SYSTEM, que tem outra pasta.
 */
async function instalarSeNecessario() {
  if (platform() !== "win32") return;
  if (!(await empacotado())) return; // rodando pelo código-fonte, não se copia

  const destino = join(process.env.LOCALAPPDATA ?? homedir(), "ZYNTRA");
  const alvo = join(destino, "ZyntraAgente.exe");

  // Já é a cópia instalada que está rodando — nada a fazer.
  if (process.execPath.toLowerCase() === alvo.toLowerCase()) return;

  mkdirSync(destino, { recursive: true });

  try {
    copyFileSync(process.execPath, alvo);
  } catch (erro) {
    // O Windows tranca o arquivo de um programa em execução. Se a cópia
    // instalada já está aberta, ela é a que vale.
    if (existsSync(alvo)) {
      registrar("já havia uma cópia instalada em uso — mantida");
      return;
    }
    throw erro;
  }

  await executar("schtasks", [
    "/Create",
    "/TN",
    "ZYNTRA - Agente de impressao",
    "/TR",
    `"${alvo}"`,
    "/SC",
    "ONLOGON",
    "/RL",
    "LIMITED",
    "/F",
  ]);

  registrar(`instalado em ${destino} — abre sozinho ao entrar no Windows`);
}

async function primeiraVez() {
  // O login é digitado, então precisa de um terminal de verdade. Sem isso o
  // readline some no fim da entrada sem resolver, e o agente sairia com
  // código de sucesso sem ter registrado nada — falha calada, justamente o
  // que não pode acontecer na instalação de uma bancada.
  if (!stdin.isTTY) {
    console.error(
      "\n  Esta máquina ainda não está registrada, e o registro precisa ser\n" +
        "  digitado. Rode o agente numa janela de terminal.\n",
    );
    return null;
  }

  const pergunta = createInterface({ input: stdin, output: stdout });

  console.log(
    "\n  Primeira vez nesta máquina.\n" +
      "  Entre com o seu e-mail e senha do ZYNTRA — os mesmos do sistema.\n" +
      "  A senha não fica guardada aqui.\n",
  );

  const email = (await pergunta.question("  E-mail: ")).trim();
  const senha = await pergunta.question("  Senha: ");
  pergunta.close();
  console.log("");

  if (!email || !senha) {
    console.error("  E-mail e senha são obrigatórios.\n");
    return null;
  }

  let sessao;
  try {
    sessao = await entrar(email, senha);
  } catch (erro) {
    console.error(`\n  Não foi possível entrar: ${erro.message}\n`);
    return null;
  }

  let registro;
  try {
    registro = await rpc(
      "registrar_dispositivo",
      { p_nome_maquina: hostname(), p_sistema: sistemaLegivel(), p_versao: VERSAO },
      sessao.access_token,
    );
  } catch (erro) {
    console.error(`\n  Não foi possível registrar esta máquina: ${erro.message}\n`);
    return null;
  }

  const r = Array.isArray(registro) ? registro[0] : registro;
  if (!r?.ok || !r?.token) {
    console.error(`\n  O servidor recusou o registro: ${r?.motivo ?? "sem motivo"}\n`);
    return null;
  }

  const novo = { token: r.token, maquina: hostname() };
  mkdirSync(dirname(ARQUIVO), { recursive: true });
  writeFileSync(ARQUIVO, JSON.stringify(novo, null, 2), { mode: 0o600 });

  registrar(`máquina registrada como "${hostname()}"`);
  console.log(
    "\n  Pronto. Agora abra o ZYNTRA em Integração → Estações e impressoras\n" +
      "  e diga qual destas impressoras é a térmica desta bancada.\n",
  );

  return novo;
}

async function lerConfig() {
  try {
    const c = JSON.parse(readFileSync(ARQUIVO, "utf8"));
    return c?.token ? c : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ servidor

async function entrar(email, senha) {
  const r = await fetch(`${SERVIDOR}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: CHAVE, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha }),
  });

  const corpo = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(corpo?.error_description ?? corpo?.msg ?? `resposta ${r.status}`);
  }
  return corpo;
}

async function rpc(funcao, corpo, comoUsuario) {
  const r = await fetch(`${SERVIDOR}/rest/v1/rpc/${funcao}`, {
    method: "POST",
    headers: {
      apikey: CHAVE,
      Authorization: `Bearer ${comoUsuario ?? CHAVE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(corpo),
  });

  if (!r.ok) throw new Error(`${funcao} respondeu ${r.status}`);
  return r.json();
}

async function concluir(id, ok, erro) {
  await rpc("agente_concluir_trabalho", {
    p_token: cfg.token,
    p_impressao_id: id,
    p_ok: ok,
    p_erro: erro ?? null,
  });
}

async function publicarImpressoras() {
  const nomes = await listarImpressoras();
  if (nomes.length === 0) {
    registrar("nenhuma impressora encontrada nesta máquina");
    return;
  }

  await rpc("publicar_impressoras", {
    p_token: cfg.token,
    p_impressoras: nomes.map((nome) => ({ nome })),
  });

  registrar(`${nomes.length} impressora(s) enviada(s): ${nomes.join(", ")}`);
}

// -------------------------------------------------------------- impressoras

/** O que o sistema operacional conhece. É esta lista que aparece no ZYNTRA. */
async function listarImpressoras() {
  if (platform() === "win32") {
    const saida = await executar("powershell", [
      "-NoProfile",
      "-Command",
      "Get-Printer | Select-Object -ExpandProperty Name",
    ]);
    return saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }

  const saida = await executar("lpstat", ["-e"]);
  return saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * O ZPL vai cru para o spooler, pelo NOME da impressora.
 *
 * No Windows isso é feito pelo `winspool.drv`, chamado pelo PowerShell que já
 * vem no sistema. O jeito antigo — copiar o arquivo para o compartilhamento de
 * rede — exigia a impressora compartilhada, um passo a mais que falha calado
 * quando alguém esquece ou quando uma atualização apaga o compartilhamento.
 */
/**
 * ZPL e PDF são dois caminhos completamente diferentes.
 *
 * ZPL é linguagem da própria impressora: vai crua para o spooler, sem driver
 * no meio. PDF é um documento — precisa de alguém que saiba desenhá-lo na
 * folha. Mandar PDF cru para a impressora imprime páginas de lixo.
 */
async function imprimir(impressora, conteudo, copias, linguagem) {
  if (!conteudo || !conteudo.trim()) throw new Error("trabalho sem conteúdo");
  if (!impressora) throw new Error("trabalho sem impressora definida");

  const lingua = linguagem ?? "zpl";

  for (let i = 0; i < copias; i++) {
    if (lingua === "pdf") {
      await imprimirPdf(impressora, conteudo);
    } else if (platform() === "win32") {
      await imprimirWindows(impressora, conteudo);
    } else {
      await executarComEntrada("lp", ["-d", impressora, "-o", "raw"], conteudo);
    }
  }
}

/**
 * O PDF chega em base64, porque a coluna que carrega o trabalho é de texto.
 *
 * Confere que o que chegou é mesmo um PDF antes de mandar para a impressora:
 * conteúdo trocado vira dezenas de páginas de lixo, e no galpão isso só se
 * descobre depois que o papel acabou.
 */
async function imprimirPdf(impressora, base64) {
  const limpo = base64.replace(/^data:application\/pdf;base64,/, "").replace(/\s/g, "");
  const bytes = Buffer.from(limpo, "base64");

  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error("o conteúdo não é um PDF — esta impressora está marcada como PDF");
  }

  const arquivo = join(tmpdir(), `zyntra-${Date.now()}.pdf`);
  writeFileSync(arquivo, bytes);

  try {
    if (platform() === "win32") {
      await imprimirPdfWindows(impressora, arquivo);
    } else {
      // O CUPS desenha PDF sozinho — sem `-o raw`, que é justamente o que
      // faria o arquivo ir cru.
      await executar("lp", ["-d", impressora, arquivo]);
    }
  } finally {
    try {
      unlinkSync(arquivo);
    } catch {
      // Temporário que não some não é motivo para falhar o trabalho.
    }
  }
}

/** Onde o SumatraPDF pode estar, se alguém o instalou nesta máquina. */
function acharSumatra() {
  const lugares = [
    join(process.env.LOCALAPPDATA ?? "", "ZYNTRA", "SumatraPDF.exe"),
    join(process.env.LOCALAPPDATA ?? "", "SumatraPDF", "SumatraPDF.exe"),
    join(process.env.PROGRAMFILES ?? "", "SumatraPDF", "SumatraPDF.exe"),
  ];
  return lugares.find((c) => c && existsSync(c)) ?? null;
}

/**
 * O Windows não traz nada de linha de comando que imprima PDF.
 *
 * Com o SumatraPDF instalado, sai calado e certo. Sem ele, resta o verbo
 * PrintTo do shell, que só funciona se houver um leitor de PDF registrado
 * para isso — o Edge, que é o padrão do Windows, não registra. Por isso a
 * falha aqui diz o que fazer em vez de só dizer que não deu.
 */
async function imprimirPdfWindows(impressora, arquivo) {
  const sumatra = acharSumatra();

  if (sumatra) {
    await executar(sumatra, [
      "-print-to",
      impressora,
      "-silent",
      "-exit-when-done",
      arquivo,
    ]);
    return;
  }

  try {
    await executar("powershell", [
      "-NoProfile",
      "-Command",
      `$ErrorActionPreference='Stop'; ` +
        `Start-Process -FilePath ${aspas(arquivo)} -Verb PrintTo ` +
        `-ArgumentList ${aspas(impressora)} -Wait -PassThru | Out-Null`,
    ]);
  } catch (erro) {
    throw new Error(
      "esta máquina não sabe imprimir PDF: não há leitor de PDF registrado " +
        "para impressão. Instale o SumatraPDF, ou marque esta impressora " +
        `como ZPL no ZYNTRA. (${erro.message})`,
    );
  }
}

async function imprimirWindows(impressora, zpl) {
  const arquivo = join(tmpdir(), `zyntra-${Date.now()}.zpl`);
  writeFileSync(arquivo, zpl, "latin1");

  // Add-Type declara a chamada ao spooler; RawPrinterHelper faz o
  // StartDocPrinter/WritePrinter, que é como se manda ZPL sem driver no meio.
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class ZyntraRaw {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.Drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool StartDocPrinter(IntPtr h, int lvl, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h, IntPtr buf, int n, out int escrito);
  public static void Enviar(string impressora, string arquivo) {
    byte[] dados = File.ReadAllBytes(arquivo);
    IntPtr h; if (!OpenPrinter(impressora, out h, IntPtr.Zero))
      throw new Exception("impressora nao encontrada: " + impressora);
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "ZYNTRA"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) throw new Exception("o spooler recusou o documento");
      try {
        if (!StartPagePrinter(h)) throw new Exception("o spooler recusou a pagina");
        IntPtr buf = Marshal.AllocCoTaskMem(dados.Length);
        try { Marshal.Copy(dados, 0, buf, dados.Length); int n;
          if (!WritePrinter(h, buf, dados.Length, out n))
            throw new Exception("falha ao escrever na impressora");
        } finally { Marshal.FreeCoTaskMem(buf); }
      } finally { EndPagePrinter(h); EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[ZyntraRaw]::Enviar(${aspas(impressora)}, ${aspas(arquivo)})
`;

  try {
    await executar("powershell", ["-NoProfile", "-Command", script]);
  } finally {
    try {
      unlinkSync(arquivo);
    } catch {
      // Temporário que não some não é motivo para falhar o trabalho.
    }
  }
}

/** Aspas simples do PowerShell, com escape de aspas dentro do nome. */
function aspas(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

// ------------------------------------------------------------------- apoio

function executar(cmd, args) {
  return executarComEntrada(cmd, args, null);
}

function executarComEntrada(cmd, args, entrada) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: [entrada === null ? "ignore" : "pipe", "pipe", "pipe"],
    });

    let saida = "";
    let erro = "";
    p.stdout.on("data", (d) => (saida += d.toString()));
    p.stderr.on("data", (d) => (erro += d.toString()));
    p.on("error", (e) => reject(new Error(`${cmd} não pôde ser executado: ${e.message}`)));
    p.on("close", (codigo) =>
      codigo === 0
        ? resolve(saida)
        : reject(new Error(erro.trim() || `${cmd} terminou com código ${codigo}`)),
    );

    if (entrada !== null) p.stdin.end(entrada);
  });
}

function sistemaLegivel() {
  const p = platform();
  return p === "win32" ? "Windows" : p === "darwin" ? "macOS" : p;
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function registrar(msg) {
  const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  console.log(`[${agora}] ${msg}`);
}

principal().then(
  (codigo) => process.exit(codigo ?? 0),
  (erro) => {
    registrar(`o agente parou: ${erro?.message ?? erro}`);
    process.exit(1);
  },
);
