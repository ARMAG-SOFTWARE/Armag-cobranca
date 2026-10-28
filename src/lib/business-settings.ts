import { DEFAULT_LATE_INTEREST_RATE_PERCENT_PER_DAY } from "@/lib/financial-rules";
import type { createClient } from "@/lib/supabase/server";
import type { BusinessSettings, WhatsAppOpenMode } from "@/lib/types";

export interface EffectiveBusinessSettings {
  lateInterestRatePercentPerDay: number;
  whatsappOpenMode: WhatsAppOpenMode;
  businessWhatsappNumber: string | null;
}

/**
 * Configurações gerais do usuário logado (RLS), com os padrões aplicados
 * quando ele ainda não salvou nada em Configurações.
 */
export async function getBusinessSettings(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<EffectiveBusinessSettings> {
  const { data } = await supabase
    .from("business_settings")
    .select("late_interest_rate_percent_per_day, whatsapp_open_mode, business_whatsapp_number")
    .maybeSingle();
  const settings = data as Pick<
    BusinessSettings,
    "late_interest_rate_percent_per_day" | "whatsapp_open_mode" | "business_whatsapp_number"
  > | null;

  return {
    lateInterestRatePercentPerDay:
      settings?.late_interest_rate_percent_per_day ?? DEFAULT_LATE_INTEREST_RATE_PERCENT_PER_DAY,
    whatsappOpenMode: settings?.whatsapp_open_mode ?? "padrao",
    businessWhatsappNumber: settings?.business_whatsapp_number ?? null,
  };
}
