import { criarClienteServidor } from "@/lib/supabase/server";
import { alternarEmissao, retomarEmissao } from "./contas-acoes";

type Tom = "ok" | "atencao" | "critico" | "neutro";

const SITUACAO_FATURADOR: Record<string, { texto: string; tom: Tom }> = {
  nao_configurado: { texto: "Não configurado", tom: "critico" },
  em_teste: { texto: "Em teste", tom: "atencao" },
  ativo: { texto: "Ativo", tom: "ok" },
  pausado: { texto: "Pausado", tom: "critico" },
};

type LinhaConta = {
  id: string;
  apelido: string;
  ref_externa: string | null;
  situacao: string;
  entra_na_esteira: boolean;
  emissao_automatica: boolean;
  emissao_pausada_em: string | null;
  emissao_pausa_motivo: string | null;
  canais: { nome: string; entra_na_esteira: boolean } | null;
  empresas: {
    razao_social: string;
    serie_nfe: string | null;
    faturador_situacao: string;
  } | null;
  pools_estoque: { nome: string } | null;
};

export async function Contas({ falha }: { falha?: string }) {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from("contas")
    .select(
      `id, apelido, ref_externa, situacao, entra_na_esteira,
       emissao_automatica, emissao_pausada_em, emissao_pausa_motivo,
       canais ( nome, entra_na_esteira ),
       empresas:empresa_emissora_id ( razao_social, serie_nfe, faturador_situacao ),
       pools_estoque:pool_estoque_id ( nome )`,
    )
    .order("apelido");

  const contas = (data ?? []) as unknown as LinhaConta[];

  if (error) {
    return (
      <Aviso
        titulo="Não foi possível ler as contas"
        texto={error.message}
        critico
      />
    );
  }

  if (contas.length === 0) {
    return (
      <Aviso
        titulo="Nenhuma conta conectada"
        texto="Conectar a primeira conta do Mercado Livre depende das credenciais da aplicação ML da Smart Depot. A emissão do dia a dia é por API, sem ninguém abrir o painel — mas o Faturador precisa estar configurado naquele CNPJ antes, com certificado A1 e dados fiscais dos anúncios."
      />
    );
  }

  return (
    <div className="flex flex-col">
      {falha && <Resultado resultado={falha} />}

      <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {[
              "Conta",
              "Canal",
              "Empresa emissora",
              "Estoque",
              "Faturador",
              "Emissão automática",
              "Série",
              "Esteira",
              "Situação",
            ].map((c) => (
              <th
                key={c}
                className="whitespace-nowrap border-b border-linha px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {contas.map((c) => {
            const fora = c.canais?.entra_na_esteira === false;
            const faturador =
              SITUACAO_FATURADOR[c.empresas?.faturador_situacao ?? ""] ??
              SITUACAO_FATURADOR.nao_configurado;
            const pausada = Boolean(c.emissao_pausada_em);

            return (
              <tr key={c.id} className={fora ? "opacity-55" : undefined}>
                <Celula>
                  <span className="text-[12.5px] font-semibold">
                    {c.apelido}
                  </span>
                  {c.ref_externa && (
                    <div className="mt-[2px] font-mono text-[11px] text-suave">
                      {c.ref_externa}
                    </div>
                  )}
                </Celula>
                <Celula>{c.canais?.nome ?? "—"}</Celula>
                <Celula>{c.empresas?.razao_social ?? "—"}</Celula>
                <Celula>{c.pools_estoque?.nome ?? "—"}</Celula>
                <Celula>
                  {fora ? (
                    <span className="text-[11.5px] text-suave">
                      emissão automática do ML
                    </span>
                  ) : pausada ? (
                    <>
                      <Selo tom="critico">Pausado</Selo>
                      {c.emissao_pausa_motivo && (
                        <div className="mt-[2px] text-[11px] text-suave">
                          {c.emissao_pausa_motivo}
                        </div>
                      )}
                    </>
                  ) : (
                    <Selo tom={faturador.tom}>{faturador.texto}</Selo>
                  )}
                </Celula>
                <Celula>
                  {fora ? (
                    <span className="text-[11.5px] text-suave">
                      não se aplica
                    </span>
                  ) : (
                    <ChaveDaEmissao conta={c} pausada={pausada} />
                  )}
                </Celula>
                <Celula>
                  <span className="font-mono">
                    {c.empresas?.serie_nfe ?? "—"}
                  </span>
                </Celula>
                <Celula>
                  {c.entra_na_esteira ? (
                    <Selo tom="ok">Sim</Selo>
                  ) : (
                    <Selo tom="neutro">Não</Selo>
                  )}
                </Celula>
                <Celula>
                  <span className="text-[11.5px] text-suave">
                    {fora
                      ? "fora da esteira — a mercadoria está no galpão do ML"
                      : c.situacao === "conectada"
                        ? "conectada"
                        : c.situacao === "erro"
                          ? "com erro"
                          : "desconectada"}
                  </span>
                </Celula>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/**
 * A chave da emissão de uma conta.
 *
 * Desligada é o estado seguro e é como toda conta nasce. Emitir nota é
 * irreversível, então ligar é uma decisão consciente, uma conta por vez.
 */
function ChaveDaEmissao({
  conta,
  pausada,
}: {
  conta: LinhaConta;
  pausada: boolean;
}) {
  if (pausada) {
    return (
      <div>
        <Selo tom="critico">Pausada pelo disjuntor</Selo>
        <form action={retomarEmissao} className="mt-[6px]">
          <input type="hidden" name="conta" value={conta.id} />
          <button
            type="submit"
            className="rounded-lg border border-critico-linha px-3 py-[6px] text-[12px] font-semibold text-critico"
          >
            Retomar emissão
          </button>
        </form>
        <p className="m-0 mt-[5px] max-w-[30ch] text-[11px] text-suave">
          Conserte a causa antes. Retomar sem consertar faz a conta pausar de
          novo em minutos.
        </p>
      </div>
    );
  }

  return (
    <form action={alternarEmissao} className="flex items-center gap-2">
      <input type="hidden" name="conta" value={conta.id} />
      <input
        type="hidden"
        name="ligar"
        value={conta.emissao_automatica ? "0" : "1"}
      />
      {conta.emissao_automatica ? (
        <>
          <Selo tom="ok">Ligada</Selo>
          <button
            type="submit"
            className="rounded-lg border border-linha px-3 py-[6px] text-[12px] font-semibold text-suave"
          >
            Desligar
          </button>
        </>
      ) : (
        <>
          <Selo tom="neutro">Desligada</Selo>
          <button
            type="submit"
            className="rounded-lg bg-tinta px-3 py-[6px] text-[12px] font-semibold text-white"
          >
            Ligar
          </button>
        </>
      )}
    </form>
  );
}

function Resultado({ resultado }: { resultado: string }) {
  const bom = ["emissao_ligada", "emissao_desligada", "emissao_retomada"];
  const texto: Record<string, string> = {
    emissao_ligada:
      "Emissão automática ligada nesta conta. Acompanhe as primeiras notas antes de ligar a próxima.",
    emissao_desligada: "Emissão automática desligada nesta conta.",
    emissao_retomada:
      "Emissão retomada. Se a causa não foi resolvida, o disjuntor pausa de novo.",
    nao_estava_pausada: "Esta conta não estava pausada.",
    sem_permissao: "Só líder ou administrador faz isso.",
    erro: "Não foi possível concluir.",
  };

  const ok = bom.includes(resultado);

  return (
    <p
      role="status"
      className={`m-0 border-b px-5 py-[10px] text-[12.5px] font-semibold ${
        ok
          ? "border-ok-linha bg-ok-bg text-ok"
          : "border-critico-linha bg-critico-bg text-critico"
      }`}
    >
      {texto[resultado] ?? texto.erro}
    </p>
  );
}

function Aviso({
  titulo,
  texto,
  critico,
}: {
  titulo: string;
  texto: string;
  critico?: boolean;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-20">
      <div className="max-w-[56ch] text-center">
        <h2
          className={`text-[20px] font-bold tracking-[-0.02em] ${critico ? "text-critico" : ""}`}
        >
          {titulo}
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-suave">{texto}</p>
      </div>
    </div>
  );
}

function Celula({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-b border-linha-suave px-3 py-[10px] align-middle text-[12.5px]">
      {children}
    </td>
  );
}

function Selo({ tom, children }: { tom: Tom; children: React.ReactNode }) {
  const estilo =
    tom === "ok"
      ? "bg-ok-bg text-ok border-ok-linha"
      : tom === "atencao"
        ? "bg-atencao-bg text-atencao border-atencao-linha"
        : tom === "critico"
          ? "bg-critico-bg text-critico border-critico-linha"
          : "border-linha text-suave";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-[9px] py-[3px] text-[11.5px] font-semibold ${estilo}`}
    >
      {children}
    </span>
  );
}
