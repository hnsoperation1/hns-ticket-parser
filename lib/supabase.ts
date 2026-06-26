import { createClient } from '@supabase/supabase-js';
import { ParsedBooking } from '@/types/booking';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface LogEntry {
  raw_message: string;
  parsed_bookings: ParsedBooking[] | null;
  rows_written: number;
  status: 'pending' | 'success' | 'error' | 'partial';
  error_message?: string;
  telegram_message_id?: number;
  telegram_chat_id?: number;
  sheet_id?: string;
  sheet_label?: string;
}

export async function logParse(entry: LogEntry): Promise<string | null> {
  const { data, error } = await supabase
    .from('ticket_parse_logs')
    .insert({
      raw_message: entry.raw_message,
      parsed_bookings: entry.parsed_bookings,
      rows_written: entry.rows_written,
      status: entry.status,
      error_message: entry.error_message ?? null,
      telegram_message_id: entry.telegram_message_id ?? null,
      telegram_chat_id: entry.telegram_chat_id ?? null,
      sheet_id: entry.sheet_id ?? null,
      sheet_label: entry.sheet_label ?? null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Supabase log error:', error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function getPendingLog(id: string) {
  const { data, error } = await supabase
    .from('ticket_parse_logs')
    .select('parsed_bookings, sheet_id, sheet_label, telegram_chat_id')
    .eq('id', id)
    .eq('status', 'pending')
    .single();

  if (error) return null;
  return data as {
    parsed_bookings: ParsedBooking[];
    sheet_id: string;
    sheet_label: string;
    telegram_chat_id: number;
  } | null;
}

export async function updateLogWritten(
  id: string,
  rowsWritten: number,
  status: 'success' | 'error' | 'partial',
  errorMessage?: string,
) {
  await supabase
    .from('ticket_parse_logs')
    .update({ rows_written: rowsWritten, status, error_message: errorMessage ?? null })
    .eq('id', id);
}
