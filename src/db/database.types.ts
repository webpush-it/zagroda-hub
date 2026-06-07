export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      booking_requests: {
        Row: {
          created_at: string
          guest_email: string
          guest_name: string
          guest_phone: string
          id: string
          participants_count: number
          status: Database["public"]["Enums"]["request_status"]
          trip_date: string
          turnus_id: string
          updated_at: string
          zagroda_id: string
        }
        Insert: {
          created_at?: string
          guest_email: string
          guest_name: string
          guest_phone: string
          id?: string
          participants_count: number
          status?: Database["public"]["Enums"]["request_status"]
          trip_date: string
          turnus_id: string
          updated_at?: string
          zagroda_id: string
        }
        Update: {
          created_at?: string
          guest_email?: string
          guest_name?: string
          guest_phone?: string
          id?: string
          participants_count?: number
          status?: Database["public"]["Enums"]["request_status"]
          trip_date?: string
          turnus_id?: string
          updated_at?: string
          zagroda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_requests_turnus_fkey"
            columns: ["turnus_id", "zagroda_id"]
            isOneToOne: false
            referencedRelation: "turnusy"
            referencedColumns: ["id", "zagroda_id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          attempts: number
          created_at: string
          html: string
          id: string
          last_error: string | null
          next_attempt_at: string
          provider_message_id: string | null
          reply_to: string | null
          sent_at: string | null
          status: string
          subject: string
          to_email: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          html: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          provider_message_id?: string | null
          reply_to?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          to_email: string
        }
        Update: {
          attempts?: number
          created_at?: string
          html?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          provider_message_id?: string | null
          reply_to?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          to_email?: string
        }
        Relationships: []
      }
      turnusy: {
        Row: {
          created_at: string
          end_time: string
          id: string
          label: string
          start_time: string
          zagroda_id: string
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          label: string
          start_time: string
          zagroda_id: string
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          label?: string
          start_time?: string
          zagroda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "turnusy_zagroda_id_fkey"
            columns: ["zagroda_id"]
            isOneToOne: false
            referencedRelation: "zagrody"
            referencedColumns: ["id"]
          },
        ]
      }
      zagrody: {
        Row: {
          city: string | null
          created_at: string
          daily_limit: number
          description: string | null
          id: string
          is_published: boolean
          name: string
          owner_id: string
          photo_path: string | null
          voivodeship: Database["public"]["Enums"]["voivodeship"] | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          daily_limit: number
          description?: string | null
          id?: string
          is_published?: boolean
          name: string
          owner_id: string
          photo_path?: string | null
          voivodeship?: Database["public"]["Enums"]["voivodeship"] | null
        }
        Update: {
          city?: string | null
          created_at?: string
          daily_limit?: number
          description?: string | null
          id?: string
          is_published?: boolean
          name?: string
          owner_id?: string
          photo_path?: string | null
          voivodeship?: Database["public"]["Enums"]["voivodeship"] | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_booking_request: {
        Args: { request_id: string }
        Returns: {
          accepted: boolean
          daily_limit: number
          occupied: number
          requested: number
        }[]
      }
      catalog_zagrody: {
        Args: {
          p_city?: string
          p_participants?: number
          p_trip_date?: string
          p_voivodeship?: Database["public"]["Enums"]["voivodeship"]
        }
        Returns: {
          city: string
          created_at: string
          daily_limit: number
          description: string
          id: string
          is_available: boolean
          name: string
          photo_path: string
          voivodeship: Database["public"]["Enums"]["voivodeship"]
        }[]
      }
      claim_due_emails: {
        Args: { p_id?: string; p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          html: string
          id: string
          last_error: string | null
          next_attempt_at: string
          provider_message_id: string | null
          reply_to: string | null
          sent_at: string | null
          status: string
          subject: string
          to_email: string
        }[]
        SetofOptions: {
          from: "*"
          to: "email_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      email_verified: { Args: never; Returns: boolean }
      set_zagroda_published: {
        Args: { publish: boolean; target_zagroda_id: string }
        Returns: boolean
      }
    }
    Enums: {
      request_status:
        | "pending"
        | "accepted"
        | "rejected"
        | "cancelled_by_guest"
        | "withdrawn_by_owner"
      voivodeship:
        | "dolnośląskie"
        | "kujawsko-pomorskie"
        | "lubelskie"
        | "lubuskie"
        | "łódzkie"
        | "małopolskie"
        | "mazowieckie"
        | "opolskie"
        | "podkarpackie"
        | "podlaskie"
        | "pomorskie"
        | "śląskie"
        | "świętokrzyskie"
        | "warmińsko-mazurskie"
        | "wielkopolskie"
        | "zachodniopomorskie"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      request_status: [
        "pending",
        "accepted",
        "rejected",
        "cancelled_by_guest",
        "withdrawn_by_owner",
      ],
      voivodeship: [
        "dolnośląskie",
        "kujawsko-pomorskie",
        "lubelskie",
        "lubuskie",
        "łódzkie",
        "małopolskie",
        "mazowieckie",
        "opolskie",
        "podkarpackie",
        "podlaskie",
        "pomorskie",
        "śląskie",
        "świętokrzyskie",
        "warmińsko-mazurskie",
        "wielkopolskie",
        "zachodniopomorskie",
      ],
    },
  },
} as const

