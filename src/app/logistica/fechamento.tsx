import { criarClienteServidor } from "@/lib/supabase/server";
import { moeda } from "./formato";

type Linha = {
  dia: string;
  modalidade: string;
  empresa_emissora: string | null;
  pacotes: number;
  total: number;
};

export async function Fechamento() {
  const supabase = await criarClienteServidor();

  const inicio = new Date();
  inicio.setDate(1);
  const de = inicio.toISOString().slice(0, 10);

  const [{ data: linhas }, { data: custos }] = await Promise.all([
    supabase
      .from("fechamento_custo_etiqueta")
      .select("*")
      .gte("dia", de)
      .order("dia", { ascending: false }),
    supabase
      .from("custos_etiqueta")
      .select("valor, vigente_de, modalidades ( nome )")
      .is("vigente_ate", null)
      .order("vigente_de", { ascending: false }),
  ]);

  const todas = (linhas ?? []) as Linha[];
  const pacotes = todas.reduce((t, l) => t + Number(l.pacotes), 0);
  const total = todas.reduce((t, l) => t + Number(l.total), 0);

  const vigentes = (custos ?? []) as unknown as {
    valor: number;
    vigente_de: string;
    modalidades: { nome: string } | null;
  }[];

  return (
    <div className="p-5">
      <div className="mb-5 flex flex-wrap gap-3">
        <Tile rotulo="Pacotes com custo que saíram" valor={String(pacotes)} />
        {vigentes.length > 0 ? (
          <Tile
            rotulo={`Etiqueta ${vigentes[0].modalidades?.nome ?? ""}`.trim()}
            valor={moeda(vigentes[0].valor)}
            nota={`vigente desde ${formatarDia(vigentes[0].vigente_de)}`}
          />
        ) : (
          <Tile rotulo="Etiqueta" valor="—" nota="nenhum custo cadastrado" />
        )}
        <Tile
          rotulo="Total do mês"
          valor={moeda(total)}
          destaque
          nota="parcial, mês em aberto"
        />
      </div>

      {todas.length === 0 ? (
        <p className="rounded-[9px] border border-linha px-4 py-6 text-center text-[13.5px] text-suave">
          Nenhum pacote saiu do galpão neste mês. O número só existe com bipe
          atrás dele — por isso ele nasce em zero em vez de em branco.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[9px] border border-linha">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Dia", "Modalidade", "Empresa emissora", "Pacotes", "Valor"].map(
                  (c) => (
                    <th
                      key={c}
                      className="whitespace-nowrap border-b border-linha px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
                    >
                      {c}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {todas.map((l, i) => (
                <tr key={i}>
                  <td className="border-b border-linha-suave px-3 py-[10px] font-mono text-[12.5px] font-semibold">
                    {formatarDia(l.dia)}
                  </td>
                  <td className="border-b border-linha-suave px-3 py-[10px] text-[12.5px]">
                    {l.modalidade}
                  </td>
                  <td className="border-b border-linha-suave px-3 py-[10px] text-[12.5px]">
                    {l.empresa_emissora ?? "—"}
                  </td>
                  <td className="border-b border-linha-suave px-3 py-[10px] font-mono text-[13px] font-semibold tabular-nums">
                    {l.pacotes}
                  </td>
                  <td className="border-b border-linha-suave px-3 py-[10px] font-mono text-[13px] font-semibold tabular-nums">
                    {moeda(l.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[12.5px] leading-relaxed text-suave">
        Cada linha abre a relação de pacotes que a compõe. O valor nasce na
        estação de saída e não de uma contagem feita depois: dá para chegar no
        pacote, na hora e em quem bipou.
      </p>
    </div>
  );
}

function formatarDia(dia: string) {
  return new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function Tile({
  rotulo,
  valor,
  nota,
  destaque,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`min-w-[190px] flex-1 rounded-[10px] border p-4 ${
        destaque ? "border-tinta bg-tinta text-white" : "border-linha"
      }`}
    >
      <div
        className={`text-[10.5px] font-semibold uppercase tracking-[0.13em] ${
          destaque ? "text-[#A9AEB6]" : "text-suave"
        }`}
      >
        {rotulo}
      </div>
      <div className="mt-[5px] font-mono text-[30px] font-semibold tracking-[-0.03em] tabular-nums">
        {valor}
      </div>
      {nota && (
        <div
          className={`mt-1 text-[11.5px] ${destaque ? "text-[#A9AEB6]" : "text-suave"}`}
        >
          {nota}
        </div>
      )}
    </div>
  );
}
