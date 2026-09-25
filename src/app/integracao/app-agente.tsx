"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/client";

const ARQUIVO = "ZyntraAgente.exe";

type Props = {
  /** Endereço público do instalador, ou null se ainda não há nenhum publicado. */
  endereco: string | null;
  publicadoEm: string | null;
  tamanhoMb: number | null;
  podePublicar: boolean;
};

/**
 * O app da bancada: baixar e publicar.
 *
 * O envio vai do navegador direto para o Storage, e não por uma ação de
 * servidor: a Vercel corta requisição em 4,5 MB e o instalador tem 26.
 */
export function AppDaBancada({
  endereco,
  publicadoEm,
  tamanhoMb,
  podePublicar,
}: Props) {
  const router = useRouter();
  const campo = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [, iniciar] = useTransition();

  async function publicar(arquivo: File) {
    setErro(null);
    setEnviando(true);
    try {
      const supabase = criarClienteNavegador();
      const { error } = await supabase.storage
        .from("app")
        .upload(ARQUIVO, arquivo, {
          upsert: true,
          contentType: "application/octet-stream",
        });

      if (error) {
        setErro(
          error.message.toLowerCase().includes("exceeded")
            ? "O arquivo passou do limite de 50 MB do plano."
            : error.message,
        );
        return;
      }
      iniciar(() => router.refresh());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não foi possível enviar");
    } finally {
      setEnviando(false);
      if (campo.current) campo.current.value = "";
    }
  }

  return (
    <section className="max-w-[560px] rounded-[9px] border border-linha px-4 py-[14px]">
      <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
        O app da bancada
      </h3>
      <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-suave">
        Baixe no computador da bancada e abra. Ele pede o e-mail e a senha do
        ZYNTRA uma vez, se instala sozinho e passa a abrir junto com o Windows.
        Não precisa instalar mais nada na máquina.
      </p>

      {endereco ? (
        <>
          <a
            href={endereco}
            download={ARQUIVO}
            className="inline-block rounded-lg border border-linha bg-superficie px-4 py-[10px] text-[13.5px] font-semibold no-underline"
          >
            Baixar o app
          </a>
          <p className="mb-0 mt-2 text-[12px] text-suave">
            Windows
            {tamanhoMb ? ` · ${tamanhoMb} MB` : ""}
            {publicadoEm ? ` · publicado ${quando(publicadoEm)}` : ""}
          </p>
        </>
      ) : (
        <p className="m-0 rounded-lg border border-atencao-linha bg-atencao-bg px-3 py-2 text-[13px] text-atencao">
          Nenhuma versão publicada ainda.
          {podePublicar
            ? " Envie o instalador abaixo para o botão aparecer."
            : " Peça a um administrador para publicar."}
        </p>
      )}

      {podePublicar && (
        <div className="mt-4 border-t border-linha-suave pt-3">
          <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] text-suave">
            Publicar nova versão
          </label>
          <input
            ref={campo}
            type="file"
            accept=".exe"
            disabled={enviando}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void publicar(f);
            }}
            className="mt-2 block w-full text-[13px] file:mr-3 file:rounded-lg file:border file:border-linha file:bg-superficie file:px-3 file:py-[6px] file:text-[12.5px] file:font-semibold"
          />
          <p className="mb-0 mt-2 text-[12px] leading-relaxed text-suave">
            {enviando
              ? "Enviando…"
              : "Substitui o que está publicado. Quem já instalou continua funcionando; a versão nova chega quando a pessoa baixar e abrir de novo."}
          </p>
          {erro && (
            <p className="mb-0 mt-2 text-[12.5px] font-semibold text-critico">
              {erro}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function quando(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}
