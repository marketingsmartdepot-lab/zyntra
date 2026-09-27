-- Acrescentar um parâmetro com default não substitui: cria SOBRECARGA. Com as
-- duas no banco, "pacotes_filtrados(...)" fica ambíguo e o PostgREST pode
-- chamar a errada — a que não conhece o filtro de lista.
drop function if exists public.pacotes_filtrados(
  etapa, text, uuid[], uuid[], text[], text[], integer);
