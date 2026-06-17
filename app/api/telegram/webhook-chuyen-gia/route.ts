import { NextRequest, NextResponse } from 'next/server';
import { parseTicketMessage } from '@/lib/openai';
import { appendBookings } from '@/lib/sheets';
import { logParse } from '@/lib/supabase';
import { sendMessage, buildSuccessMessage } from '@/lib/telegram';

const SHEET = {
  sheetId: process.env.GOOGLE_SHEET_ID_CHUYEN_GIA,
  label: 'Google Sheets Chuyên Gia',
};

const BOT_TOKEN_ENV = 'TELEGRAM_BOT_TOKEN_CHUYEN_GIA';
const SECRET_ENV = 'TELEGRAM_WEBHOOK_SECRET_CHUYEN_GIA';

interface TelegramUpdate {
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  caption?: string;
}

function isTicketMessage(text: string): boolean {
  return text.includes('Xuất vé thành công') || text.includes('Code:');
}

export async function POST(req: NextRequest) {
  const secret = process.env[SECRET_ENV];
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

  const text = msg.text ?? msg.caption ?? '';
  if (!isTicketMessage(text)) return NextResponse.json({ ok: true });

  const { sheetId, label } = SHEET;

  if (!sheetId) {
    await sendMessage(msg.chat.id, '❌ Sheet ID chưa được cấu hình.', process.env[BOT_TOKEN_ENV]!);
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
      telegram_message_id: msg.message_id,
      telegram_chat_id: msg.chat.id,
    });
    await sendMessage(msg.chat.id, '❌ Không đọc được thông tin vé. Kiểm tra lại định dạng tin nhắn.', process.env[BOT_TOKEN_ENV]!);
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
    raw_message: text,
    parsed_bookings: parseResult.bookings,
    rows_written: rowsWritten,
    status,
    error_message: errorMessage,
    telegram_message_id: msg.message_id,
    telegram_chat_id: msg.chat.id,
  });

  if (status === 'success') {
    await sendMessage(msg.chat.id, buildSuccessMessage(rowsWritten, sheetId, label), process.env[BOT_TOKEN_ENV]!);
  }

  return NextResponse.json({ ok: true });
}
