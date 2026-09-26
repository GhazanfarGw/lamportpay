export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_reference: string | null
          entity_type: string
          field: string | null
          id: string
          new_value: string | null
          note: string | null
          old_value: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_reference?: string | null
          entity_type: string
          field?: string | null
          id?: string
          new_value?: string | null
          note?: string | null
          old_value?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_reference?: string | null
          entity_type?: string
          field?: string | null
          id?: string
          new_value?: string | null
          note?: string | null
          old_value?: string | null
        }
        Relationships: []
      }
      admin_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      mock_kyc_submissions: {
        Row: {
          country: string
          created_at: string
          document_type: string
          email: string
          full_name: string
          id: string
          reference: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          country: string
          created_at?: string
          document_type?: string
          email: string
          full_name: string
          id?: string
          reference: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          country?: string
          created_at?: string
          document_type?: string
          email?: string
          full_name?: string
          id?: string
          reference?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      mock_payout_transfers: {
        Row: {
          admin_note: string | null
          created_at: string
          funded_at: string | null
          fx_rate: number
          id: string
          kyc_submission_id: string | null
          partner_reference: string | null
          payment_rail: string
          payment_status: string
          payout_amount: number
          payout_currency: string
          quote_status: string
          recipient_name: string
          reference: string
          send_amount: number
          send_currency: string
          sender_name: string
          settled_at: string | null
          solana_tx_signature: string | null
          timeline_note: string | null
          total_fee: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          funded_at?: string | null
          fx_rate: number
          id?: string
          kyc_submission_id?: string | null
          partner_reference?: string | null
          payment_rail?: string
          payment_status?: string
          payout_amount: number
          payout_currency: string
          quote_status?: string
          recipient_name: string
          reference: string
          send_amount: number
          send_currency?: string
          sender_name: string
          settled_at?: string | null
          solana_tx_signature?: string | null
          timeline_note?: string | null
          total_fee?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          funded_at?: string | null
          fx_rate?: number
          id?: string
          kyc_submission_id?: string | null
          partner_reference?: string | null
          payment_rail?: string
          payment_status?: string
          payout_amount?: number
          payout_currency?: string
          quote_status?: string
          recipient_name?: string
          reference?: string
          send_amount?: number
          send_currency?: string
          sender_name?: string
          settled_at?: string | null
          solana_tx_signature?: string | null
          timeline_note?: string | null
          total_fee?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mock_payout_transfers_kyc_submission_id_fkey"
            columns: ["kyc_submission_id"]
            isOneToOne: false
            referencedRelation: "mock_kyc_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          created_at: string
          detail: Json | null
          from_status: string | null
          id: number
          kind: string
          payment_id: string
          source: string
          to_status: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json | null
          from_status?: string | null
          id?: never
          kind: string
          payment_id: string
          source: string
          to_status?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json | null
          from_status?: string | null
          id?: never
          kind?: string
          payment_id?: string
          source?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          actual_payout_currency: string | null
          actual_payout_minor: number | null
          beneficiary_summary: Json | null
          created_at: string
          deposit_address: string | null
          deposit_amount_minor: number | null
          destination_amount_minor: number | null
          destination_country: string
          destination_currency: string
          exchange_rate: number | null
          failure_reason: string | null
          fees: Json | null
          funding_payer: string | null
          funding_signature: string | null
          funding_verified_at: string | null
          id: string
          payer_wallet: string | null
          pre_hold_status: string | null
          purpose_code: string | null
          quote_expires_at: string | null
          quote_id: string | null
          quote_snapshot: Json | null
          reconciled_at: string | null
          source_amount_minor: number
          source_currency: string
          source_network: string
          stables_customer_id: string | null
          status: string
          transfer_id: string | null
          transfer_snapshot: Json | null
          travel_rule_expires_at: string | null
          travel_rule_reference: string | null
          travel_rule_requested_at: string | null
          travel_rule_resolved_at: string | null
          travel_rule_verification_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_payout_currency?: string | null
          actual_payout_minor?: number | null
          beneficiary_summary?: Json | null
          created_at?: string
          deposit_address?: string | null
          deposit_amount_minor?: number | null
          destination_amount_minor?: number | null
          destination_country: string
          destination_currency: string
          exchange_rate?: number | null
          failure_reason?: string | null
          fees?: Json | null
          funding_payer?: string | null
          funding_signature?: string | null
          funding_verified_at?: string | null
          id?: string
          payer_wallet?: string | null
          pre_hold_status?: string | null
          purpose_code?: string | null
          quote_expires_at?: string | null
          quote_id?: string | null
          quote_snapshot?: Json | null
          reconciled_at?: string | null
          source_amount_minor: number
          source_currency?: string
          source_network?: string
          stables_customer_id?: string | null
          status?: string
          transfer_id?: string | null
          transfer_snapshot?: Json | null
          travel_rule_expires_at?: string | null
          travel_rule_reference?: string | null
          travel_rule_requested_at?: string | null
          travel_rule_resolved_at?: string | null
          travel_rule_verification_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_payout_currency?: string | null
          actual_payout_minor?: number | null
          beneficiary_summary?: Json | null
          created_at?: string
          deposit_address?: string | null
          deposit_amount_minor?: number | null
          destination_amount_minor?: number | null
          destination_country?: string
          destination_currency?: string
          exchange_rate?: number | null
          failure_reason?: string | null
          fees?: Json | null
          funding_payer?: string | null
          funding_signature?: string | null
          funding_verified_at?: string | null
          id?: string
          payer_wallet?: string | null
          pre_hold_status?: string | null
          purpose_code?: string | null
          quote_expires_at?: string | null
          quote_id?: string | null
          quote_snapshot?: Json | null
          reconciled_at?: string | null
          source_amount_minor?: number
          source_currency?: string
          source_network?: string
          stables_customer_id?: string | null
          status?: string
          transfer_id?: string | null
          transfer_snapshot?: Json | null
          travel_rule_expires_at?: string | null
          travel_rule_reference?: string | null
          travel_rule_requested_at?: string | null
          travel_rule_resolved_at?: string | null
          travel_rule_verification_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stables_customers: {
        Row: {
          base_payout_status: string | null
          created_at: string
          kyc_link: string | null
          kyc_link_expires_at: string | null
          stables_customer_id: string
          updated_at: string
          user_id: string
          verification_status: string | null
          verification_sub_status: string[] | null
        }
        Insert: {
          base_payout_status?: string | null
          created_at?: string
          kyc_link?: string | null
          kyc_link_expires_at?: string | null
          stables_customer_id: string
          updated_at?: string
          user_id: string
          verification_status?: string | null
          verification_sub_status?: string[] | null
        }
        Update: {
          base_payout_status?: string | null
          created_at?: string
          kyc_link?: string | null
          kyc_link_expires_at?: string | null
          stables_customer_id?: string
          updated_at?: string
          user_id?: string
          verification_status?: string | null
          verification_sub_status?: string[] | null
        }
        Relationships: []
      }
      stables_webhook_events: {
        Row: {
          event_id: string
          event_object_id: string | null
          event_object_status: string | null
          event_type: string
          payload: Json
          process_error: string | null
          processed_at: string | null
          received_at: string
        }
        Insert: {
          event_id: string
          event_object_id?: string | null
          event_object_status?: string | null
          event_type: string
          payload: Json
          process_error?: string | null
          processed_at?: string | null
          received_at?: string
        }
        Update: {
          event_id?: string
          event_object_id?: string | null
          event_object_status?: string | null
          event_type?: string
          payload?: Json
          process_error?: string | null
          processed_at?: string | null
          received_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "reviewer" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "reviewer", "user"],
    },
  },
} as const
