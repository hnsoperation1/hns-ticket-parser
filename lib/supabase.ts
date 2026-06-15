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
  status: 'success' | 'error' | 'partial';
  error_message?: string;
  telegram_message_id?: number;
  telegram_chat_id?: number;
}

export async function logParse(entry: LogEntry) {
  const { error } = await supabase.from('ticket_parse_logs').insert({
    raw_message: entry.raw_message,
    parsed_bookings: entry.parsed_bookings,
    rows_written: entry.rows_written,
    status: entry.status,
    error_message: entry.error_message ?? null,
    telegram_message_id: entry.telegram_message_id ?? null,
    telegram_chat_id: entry.telegram_chat_id ?? null,
  });

  if (error) {
    console.error('Supabase log error:', error.message);
  }
}
