/**
 * Empacota o agente num executável único.
 *
 * Usa o recurso de Single Executable Application do próprio Node: o código é
 * juntado num arquivo só e injetado dentro de uma cópia do `node`. O resultado
 * roda em máquina sem Node instalado, que é o ponto — ninguém no galpão vai
 * instalar runtime nenhum.
 *
 * Roda no mesmo sistema operacional de destino. O executável do Windows é
 * gerado no Windows (pelo workflow do repositório), porque binário de Windows
 * montado num Mac é binário que ninguém abriu antes de entregar.
 */

import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";

const RAIZ = import.meta.dirname;
const SAIDA = join(RAIZ, "dist");
const WIN = platform() === "win32";
const NOME = WIN ? "ZyntraAgente.exe" : "ZyntraAgente";

rmSync(SAIDA, { recursive: true, force: true });
mkdirSync(SAIDA, { recursive: true });

// 1. Um arquivo só, em CommonJS — o formato que o empacotador aceita.
//
// Pela API, não pelo executável: o atalho do esbuild em node_modules/.bin tem
// nome diferente no Windows, e chamar o shim por caminho não funciona.
console.log("empacotando o código…");
await build({
  entryPoints: [join(RAIZ, "agente.mjs")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: join(SAIDA, "agente.cjs"),
});

// 2. O blob que vai dentro do executável.
writeFileSync(
  join(SAIDA, "sea.json"),
  JSON.stringify({
    main: join(SAIDA, "agente.cjs"),
    output: join(SAIDA, "sea.blob"),
    disableExperimentalSEAWarning: true,
  }),
);

console.log("gerando o blob…");
try {
  execFileSync(process.execPath, ["--experimental-sea-config", join(SAIDA, "sea.json")], {
    stdio: "inherit",
  });
} catch {
  // Nem todo Node traz o empacotador: o do Homebrew, por exemplo, é compilado
  // sem ele. Dizer isso é mais útil do que despejar a pilha de erro.
  console.error(
    `\n  Este Node (${process.version}, em ${process.execPath}) foi compilado\n` +
      "  sem o empacotador de executável único, então não dá para gerar o\n" +
      "  binário aqui.\n\n" +
      "  O executável do Windows sai do workflow \"Agente de impressão\", na\n" +
      "  aba Actions do repositório. Para gerar um local, use o Node oficial\n" +
      "  de nodejs.org.\n\n" +
      `  O código empacotado ficou pronto em ${join(SAIDA, "agente.cjs")}.\n`,
  );
  process.exit(1);
}

// 3. Uma cópia do próprio Node vira o executável.
const alvo = join(SAIDA, NOME);
copyFileSync(process.execPath, alvo);

// A assinatura do macOS quebra ao injetar; é preciso removê-la antes e
// reassinar depois, senão o binário nem abre.
if (platform() === "darwin") {
  try {
    execFileSync("codesign", ["--remove-signature", alvo]);
  } catch {
    // Sem codesign na máquina, segue: o aviso aparece só na hora de abrir.
  }
}

console.log("injetando…");
execFileSync(
  process.execPath,
  [
    join(RAIZ, "node_modules", "postject", "dist", "cli.js"),
    alvo,
    "NODE_SEA_BLOB",
    join(SAIDA, "sea.blob"),
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ...(platform() === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : []),
  ],
  { stdio: "inherit" },
);

if (platform() === "darwin") {
  try {
    execFileSync("codesign", ["--sign", "-", alvo]);
  } catch {
    // idem
  }
}

// 4. Conferir que o que saiu abre. Um executável que não roda não é entrega.
console.log("conferindo…");
const versao = execFileSync(alvo, ["--versao"], { encoding: "utf8" }).trim();
console.log(`\n  ${NOME} → ${versao}\n  em ${alvo}\n`);
