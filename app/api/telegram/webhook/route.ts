import { NextRequest, NextResponse } from 'next/server';
import { parseTicketMessage } from '@/lib/openai';
import { appendBookings } from '@/lib/sheets';
import { logParse } from '@/lib/supabase';
import { sendMessage, buildSuccessMessage } from '@/lib/telegram';

// Telegram message filter: only process ticket-related messages
function isTicketMessage(text: string): boolean {
  return text.includes('Xuất vé thành công') || text.includes('Code:');
}

function extractText(body: TelegramUpdate): string | null {
  const msg = body.message ?? body.channel_post;
  if (!msg) return null;
  // Handle forwarded messages too
  return msg.text ?? msg.caption ?? null;
}

interface TelegramUpdate {
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  caption?: string;
  forward_from?: { id: number };
  forward_from_chat?: { id: number };
}

export async function POST(req: NextRequest) {
  // Verify webhook secret if configured
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const headerSecret = req.headers.get('x-telegram-bot-api-secret-token');
    if (headerSecret !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: TelegramUpdate;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const text = extractText(body);
  const msg = body.message ?? body.channel_post;

  // Silently acknowledge non-ticket messages
  if (!text || !isTicketMessage(text)) {
    return NextResponse.json({ ok: true });
  }

  const parseResult = await parseTicketMessage(text);

  if (!parseResult.success || parseResult.bookings.length === 0) {
    await logParse({
      raw_message: text,
      parsed_bookings: null,
      rows_written: 0,
      status: 'error',
      error_message: parseResult.error ?? 'No bookings extracted',
      telegram_message_id: msg?.message_id,
      telegram_chat_id: msg?.chat.id,
    });
    return NextResponse.json({ ok: true });
  }

  let rowsWritten = 0;
  let status: 'success' | 'error' | 'partial' = 'success';
  let errorMessage: string | undefined;

  try {
    rowsWritten = await appendBookings(parseResult.bookings);
  } catch (err) {
    status = 'partial';
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  await logParse({
    raw_message: text,
    parsed_bookings: parseResult.bookings,
    rows_written: rowsWritten,
    status,
    error_message: errorMessage,
    telegram_message_id: msg?.message_id,
    telegram_chat_id: msg?.chat.id,
  });

  if (status === 'success' && msg?.chat.id) {
    await sendMessage(msg.chat.id, buildSuccessMessage(rowsWritten));
  }

  return NextResponse.json({ ok: true, rows_written: rowsWritten });
}
