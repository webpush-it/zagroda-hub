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
          cancel_token: string
          created_at: string
          group_type: Database["public"]["Enums"]["group_type"] | null
          guest_email: string | null
          guest_name: string | null
          guest_phone: string | null
          id: string
          note: string | null
          participants_count: number
          source: Database["public"]["Enums"]["booking_source"]
          status: Database["public"]["Enums"]["request_status"]
          trip_date: string
          turnus_id: string
          updated_at: string
          zagroda_id: string
        }
        Insert: {
          cancel_token?: string
          created_at?: string
          group_type?: Database["public"]["Enums"]["group_type"] | null
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          note?: string | null
          participants_count: number
          source?: Database["public"]["Enums"]["booking_source"]
          status?: Database["public"]["Enums"]["request_status"]
          trip_date: string
          turnus_id: string
          updated_at?: string
          zagroda_id: string
        }
        Update: {
          cancel_token?: string
          created_at?: string
          group_type?: Database["public"]["Enums"]["group_type"] | null
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          note?: string | null
          participants_count?: number
          source?: Database["public"]["Enums"]["booking_source"]
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
      day_blocks: {
        Row: {
          blocked_date: string
          created_at: string
          id: string
          zagroda_id: string
        }
        Insert: {
          blocked_date: string
          created_at?: string
          id?: string
          zagroda_id: string
        }
        Update: {
          blocked_date?: string
          created_at?: string
          id?: string
          zagroda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "day_blocks_zagroda_id_fkey"
            columns: ["zagroda_id"]
            isOneToOne: false
            referencedRelation: "zagrody"
            referencedColumns: ["id"]
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
      localities: {
        Row: {
          latitude: number
          longitude: number
          name: string
          name_normalized: string
          voivodeship: Database["public"]["Enums"]["voivodeship"]
        }
        Insert: {
          latitude: number
          longitude: number
          name: string
          name_normalized: string
          voivodeship: Database["public"]["Enums"]["voivodeship"]
        }
        Update: {
          latitude?: number
          longitude?: number
          name?: string
          name_normalized?: string
          voivodeship?: Database["public"]["Enums"]["voivodeship"]
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
      voivodeship_centroids: {
        Row: {
          latitude: number
          longitude: number
          voivodeship: Database["public"]["Enums"]["voivodeship"]
        }
        Insert: {
          latitude: number
          longitude: number
          voivodeship: Database["public"]["Enums"]["voivodeship"]
        }
        Update: {
          latitude?: number
          longitude?: number
          voivodeship?: Database["public"]["Enums"]["voivodeship"]
        }
        Relationships: []
      }
      zagrody: {
        Row: {
          city: string | null
          created_at: string
          daily_limit: number
          description: string | null
          id: string
          is_published: boolean
          latitude: number | null
          location_precise: boolean
          location_source: string
          longitude: number | null
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
          latitude?: number | null
          location_precise?: boolean
          location_source?: string
          longitude?: number | null
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
          latitude?: number | null
          location_precise?: boolean
          location_source?: string
          longitude?: number | null
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
          day_blocked: boolean
          occupied: number
          requested: number
        }[]
      }
      block_day: {
        Args: { p_blocked_date: string; p_zagroda_id: string }
        Returns: {
          already_blocked: boolean
          blocked: boolean
        }[]
      }
      cancel_booking_request: {
        Args: { p_token: string }
        Returns: {
          cancelled: boolean
          status: Database["public"]["Enums"]["request_status"]
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
          latitude: number
          location_precise: boolean
          longitude: number
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
      create_manual_booking: {
        Args: {
          p_group_type?: Database["public"]["Enums"]["group_type"]
          p_note?: string
          p_participants: number
          p_trip_date: string
          p_turnus_id: string
          p_zagroda_id: string
        }
        Returns: {
          created: boolean
          daily_limit: number
          day_blocked: boolean
          occupied: number
          request_id: string
          requested: number
        }[]
      }
      email_verified: { Args: never; Returns: boolean }
      locality_coords: {
        Args: {
          p_city: string
          p_voivodeship: Database["public"]["Enums"]["voivodeship"]
        }
        Returns: {
          is_precise: boolean
          latitude: number
          longitude: number
        }[]
      }
      locality_normalize: { Args: { p_name: string }; Returns: string }
      password_account_exists: { Args: { p_email: string }; Returns: boolean }
      reject_booking_request: {
        Args: { request_id: string }
        Returns: {
          rejected: boolean
          status: Database["public"]["Enums"]["request_status"]
        }[]
      }
      set_zagroda_published: {
        Args: { publish: boolean; target_zagroda_id: string }
        Returns: boolean
      }
      unblock_day: {
        Args: { p_blocked_date: string; p_zagroda_id: string }
        Returns: {
          unblocked: boolean
        }[]
      }
      withdraw_booking_request: {
        Args: { request_id: string }
        Returns: {
          status: Database["public"]["Enums"]["request_status"]
          withdrawn: boolean
        }[]
      }
    }
    Enums: {
      booking_source: "app" | "phone"
      group_type: "szkola" | "przedszkole" | "grupa_indywidualna" | "inna"
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
      booking_source: ["app", "phone"],
      group_type: ["szkola", "przedszkole", "grupa_indywidualna", "inna"],
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

