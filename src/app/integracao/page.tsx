import { redirect } from "next/navigation";
import { Casca } from "@/components/casca";
import { criarClienteServidor } from "@/lib/supabase/server";

export const metadata = { title: "Integração — ZYNTRA" };

const SITUACAO_FATURADOR: Record<string, { texto: string; tom: Tom }> = {
  nao_configurado: { texto: "Não configurado", tom: "critico" },
  em_teste: { texto: "Em teste", tom: "atencao" },
  ativo: { texto: "Ativo", tom: "ok" },
  pausado: { texto: "Pausado", tom: "critico" },
};

type Tom = "ok" | "atencao" | "critico" | "neutro";

export default async function PaginaIntegracao() {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/integracao");

  const { data: contas, error } = await supabase
    .from("contas")
    .select(
      `id, apelido, ref_externa, situacao, entra_na_esteira,
       emissao_automatica, emissao_pausada_em, emissao_pausa_motivo,
       canais ( nome, entra_na_esteira ),
       empresas:empresa_emissora_id ( razao_social, serie_nfe, faturador_situacao ),
       pools_estoque:pool_estoque_id ( nome )`,
    )
    .order("apelido");

  return (
    <Casca frente="integracao" email={user.email ?? "sem e-mail"}>
      <div className="flex shrink-0 items-center gap-3 border-b border-linha bg-superficie px-5 py-4">
        <h1 className="text-[17px] font-bold tracking-[-0.02em]">
          Conexão das contas
        </h1>
        <p className="text-[12.5px] text-suave">
          Quem fatura e de quem é o estoque são coisas separadas. Aqui isso fica
          explícito.
        </p>
        <span className="flex-1" />
        <span className="text-[12.5px] text-suave">
          {contas?.length ?? 0} conta{contas?.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex-1 bg-superficie">
        {error ? (
          <Aviso
            titulo="Não foi possível ler as contas"
            texto={error.message}
            tom="critico"
          />
        ) : !contas || contas.length === 0 ? (
          <Aviso
            titulo="Nenhuma conta conectada"
            texto="Conectar a primeira conta do Mercado Livre depende das credenciais da aplicação ML da Smart Depot — client id e secret. Enquanto elas não existirem, esta tela fica honestamente vazia."
          />
        ) : (
          <Tabela contas={contas} />
        )}
      </div>
    </Casca>
  );
}

function Aviso({
  titulo,
  texto,
  tom = "neutro",
}: {
  titulo: string;
  texto: string;
  tom?: Tom;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-20">
      <div className="max-w-[52ch] text-center">
        <h2
          className={`text-[20px] font-bold tracking-[-0.02em] ${
            tom === "critico" ? "text-critico" : ""
          }`}
        >
          {titulo}
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-suave">{texto}</p>
      </div>
    </div>
  );
}

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

function Tabela({ contas }: { contas: LinhaConta[] }) {
  return (
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
