import { NextRequest, NextResponse } from 'next/server';
import { parseTicketMessage } from '@/lib/openai';
import { appendBookings } from '@/lib/sheets';
import { logParse } from '@/lib/supabase';
import { sendMessage, buildSuccessMessage } from '@/lib/telegram';

// Map command → { sheetId, label hiển thị trong thông báo }
const COMMAND_CONFIG: Record<string, { sheetId: string | undefined; label: string }> = {
  '/doc_ve': {
    sheetId: process.env.GOOGLE_SHEET_ID,
    label: 'Google Sheets',
  },
  '/doc_ve_chuyen_gia': {
    sheetId: process.env.GOOGLE_SHEET_ID_CHUYEN_GIA,
    label: 'Google Sheets Chuyên Gia',
  },
};

interface TelegramUpdate {
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
}

function extractCommandAndText(msg: TelegramMessage): { command: string; ticketText: string } | null {
  const text = msg.text ?? '';
  const command = Object.keys(COMMAND_CONFIG).find((cmd) => text.startsWith(cmd));
  if (!command) return null;

  // Cách 2: reply vào tin vé
  if (msg.reply_to_message) {
    const ticketText = msg.reply_to_message.text ?? msg.reply_to_message.caption ?? null;
    if (!ticketText) return null;
    return { command, ticketText };
  }

  // Cách 1: nội dung sau command
  const content = text.slice(command.length).trim();
  if (!content) return null;
  return { command, ticketText: content };
}

export async function POST(req: NextRequest) {
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

  const msg = body.message ?? body.channel_post;
  if (!msg) return NextResponse.json({ ok: true });

  const extracted = extractCommandAndText(msg);
  if (!extracted) return NextResponse.json({ ok: true });

  const { command, ticketText } = extracted;
  const { sheetId, label } = COMMAND_CONFIG[command];

  if (!sheetId) {
    await sendMessage(msg.chat.id, `❌ Sheet ID chưa được cấu hình cho lệnh ${command}.`);
    return NextResponse.json({ ok: true });
  }

  const parseResult = await parseTicketMessage(ticketText);

  if (!parseResult.success || parseResult.bookings.length === 0) {
    await logParse({
      raw_message: ticketText,
      parsed_bookings: null,
      rows_written: 0,
      status: 'error',
      error_message: parseResult.error ?? 'No bookings extracted',
      telegram_message_id: msg.message_id,
      telegram_chat_id: msg.chat.id,
    });
    await sendMessage(msg.chat.id, '❌ Không đọc được thông tin vé. Kiểm tra lại định dạng tin nhắn.');
    return NextResponse.json({ ok: true });
  }

  let rowsWritten = 0;
  let status: 'success' | 'error' | 'partial' = 'success';
  let errorMessage: string | undefined;

  try {
    rowsWritten = await appendBookings(parseResult.bookings, sheetId);
  } catch (err) {
    status = 'partial';
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  await logParse({
    raw_message: ticketText,
    parsed_bookings: parseResult.bookings,
    rows_written: rowsWritten,
    status,
    error_message: errorMessage,
    telegram_message_id: msg.message_id,
    telegram_chat_id: msg.chat.id,
  });

  if (status === 'success') {
    await sendMessage(msg.chat.id, buildSuccessMessage(rowsWritten, sheetId, label));
  }

  return NextResponse.json({ ok: true, rows_written: rowsWritten });
}
