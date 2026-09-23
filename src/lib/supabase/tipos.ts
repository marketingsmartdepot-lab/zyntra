/**
 * Tipos do banco, gerados a partir do schema do zyntra-prod.
 * Não editar à mão: quando o schema mudar, gerar de novo.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      canais: {
        Row: {
          ativo: boolean;
          criado_em: string;
          entra_na_esteira: boolean;
          id: string;
          nome: string;
          slug: string;
        };
        Insert: {
          ativo?: boolean;
          criado_em?: string;
          entra_na_esteira?: boolean;
          id?: string;
          nome: string;
          slug: string;
        };
        Update: {
          ativo?: boolean;
          criado_em?: string;
          entra_na_esteira?: boolean;
          id?: string;
          nome?: string;
          slug?: string;
        };
        Relationships: [];
      };
      contas: {
        Row: {
          apelido: string;
          atualizado_em: string;
          canal_id: string;
          conectada_em: string | null;
          criada_em: string;
          emissao_automatica: boolean;
          emissao_pausa_motivo: string | null;
          emissao_pausada_em: string | null;
          empresa_emissora_id: string | null;
          entra_na_esteira: boolean;
          id: string;
          importar_desde: string | null;
          pool_estoque_id: string | null;
          ref_externa: string | null;
          situacao: string;
          ultimo_erro: string | null;
        };
        Insert: {
          apelido: string;
          atualizado_em?: string;
          canal_id: string;
          conectada_em?: string | null;
          criada_em?: string;
          emissao_automatica?: boolean;
          emissao_pausa_motivo?: string | null;
          emissao_pausada_em?: string | null;
          empresa_emissora_id?: string | null;
          entra_na_esteira?: boolean;
          id?: string;
          importar_desde?: string | null;
          pool_estoque_id?: string | null;
          ref_externa?: string | null;
          situacao?: string;
          ultimo_erro?: string | null;
        };
        Update: {
          apelido?: string;
          atualizado_em?: string;
          canal_id?: string;
          conectada_em?: string | null;
          criada_em?: string;
          emissao_automatica?: boolean;
          emissao_pausa_motivo?: string | null;
          emissao_pausada_em?: string | null;
          empresa_emissora_id?: string | null;
          entra_na_esteira?: boolean;
          id?: string;
          importar_desde?: string | null;
          pool_estoque_id?: string | null;
          ref_externa?: string | null;
          situacao?: string;
          ultimo_erro?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contas_canal_id_fkey";
            columns: ["canal_id"];
            isOneToOne: false;
            referencedRelation: "canais";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contas_empresa_emissora_id_fkey";
            columns: ["empresa_emissora_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contas_pool_estoque_id_fkey";
            columns: ["pool_estoque_id"];
            isOneToOne: false;
            referencedRelation: "pools_estoque";
            referencedColumns: ["id"];
          },
        ];
      };
      empresas: {
        Row: {
          ativa: boolean;
          atualizado_em: string;
          cnpj: string | null;
          criada_em: string;
          faturador_observacao: string | null;
          faturador_situacao: string;
          id: string;
          nome_curto: string;
          razao_social: string;
          serie_nfe: string | null;
        };
        Insert: {
          ativa?: boolean;
          atualizado_em?: string;
          cnpj?: string | null;
          criada_em?: string;
          faturador_observacao?: string | null;
          faturador_situacao?: string;
          id?: string;
          nome_curto: string;
          razao_social: string;
          serie_nfe?: string | null;
        };
        Update: {
          ativa?: boolean;
          atualizado_em?: string;
          cnpj?: string | null;
          criada_em?: string;
          faturador_observacao?: string | null;
          faturador_situacao?: string;
          id?: string;
          nome_curto?: string;
          razao_social?: string;
          serie_nfe?: string | null;
        };
        Relationships: [];
      };
      perfis: {
        Row: {
          ativo: boolean;
          atualizado_em: string;
          criado_em: string;
          email: string;
          id: string;
          nome: string;
          papel: Database["public"]["Enums"]["papel"];
        };
        Insert: {
          ativo?: boolean;
          atualizado_em?: string;
          criado_em?: string;
          email: string;
          id: string;
          nome: string;
          papel?: Database["public"]["Enums"]["papel"];
        };
        Update: {
          ativo?: boolean;
          atualizado_em?: string;
          criado_em?: string;
          email?: string;
          id?: string;
          nome?: string;
          papel?: Database["public"]["Enums"]["papel"];
        };
        Relationships: [];
      };
      pools_estoque: {
        Row: {
          ativo: boolean;
          atualizado_em: string;
          criado_em: string;
          empresa_dona_id: string | null;
          erp_deposito_ref: string | null;
          id: string;
          nome: string;
        };
        Insert: {
          ativo?: boolean;
          atualizado_em?: string;
          criado_em?: string;
          empresa_dona_id?: string | null;
          erp_deposito_ref?: string | null;
          id?: string;
          nome: string;
        };
        Update: {
          ativo?: boolean;
          atualizado_em?: string;
          criado_em?: string;
          empresa_dona_id?: string | null;
          erp_deposito_ref?: string | null;
          id?: string;
          nome?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pools_estoque_empresa_dona_id_fkey";
            columns: ["empresa_dona_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<never, never>;
    Functions: {
      e_admin: { Args: never; Returns: boolean };
      papel_atual: {
        Args: never;
        Returns: Database["public"]["Enums"]["papel"];
      };
    };
    Enums: {
      papel: "operador" | "lider" | "analista" | "admin";
    };
    CompositeTypes: Record<never, never>;
  };
};

type EsquemaPublico = Database["public"];

export type Tabela<N extends keyof EsquemaPublico["Tables"]> =
  EsquemaPublico["Tables"][N]["Row"];

export type Insercao<N extends keyof EsquemaPublico["Tables"]> =
  EsquemaPublico["Tables"][N]["Insert"];

export type Atualizacao<N extends keyof EsquemaPublico["Tables"]> =
  EsquemaPublico["Tables"][N]["Update"];

export type Papel = EsquemaPublico["Enums"]["papel"];
