import { NextRequest, NextResponse } from 'next/server';
import { parseTicketMessage } from '@/lib/openai';
import { appendBookings } from '@/lib/sheets';
import { logParse } from '@/lib/supabase';
import { sendMessage, buildSuccessMessage } from '@/lib/telegram';

const COMMAND_CONFIG: Record<string, { sheetId: string | undefined; label: string }> = {
  '/doc_ve': {
    sheetId: process.env.GOOGLE_SHEET_ID,
    label: 'Google Sheets',
  },
};

const AUTO_SHEET = {
  sheetId: process.env.GOOGLE_SHEET_ID,
  label: 'Google Sheets',
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

function isTicketMessage(text: string): boolean {
  return text.includes('Xuất vé thành công') || text.includes('Code:');
}

function extractCommandMode(msg: TelegramMessage): { ticketText: string; sheetId: string | undefined; label: string } | null {
  const rawText = msg.text ?? '';
  // Bỏ @BotName nếu có: /doc_ve@HnsKtVeBot → /doc_ve
  const text = rawText.replace(/@\S+/, '').trim();

  // Sort dài trước để tránh /doc_ve match nhầm /doc_ve_chuyen_gia
  const command = Object.keys(COMMAND_CONFIG)
    .sort((a, b) => b.length - a.length)
    .find((cmd) => text === cmd || text.startsWith(cmd + ' '));
  if (!command) return null;

  const config = COMMAND_CONFIG[command];

  // Cách 2: reply vào tin vé
  if (msg.reply_to_message) {
    const ticketText = msg.reply_to_message.text ?? msg.reply_to_message.caption ?? null;
    if (!ticketText) return null;
    return { ticketText, ...config };
  }

  // Cách 1: nội dung sau command
  const content = text.slice(command.length).trim();
  if (!content) return null;
  return { ticketText: content, ...config };
}

function extractAutoMode(msg: TelegramMessage): { ticketText: string; sheetId: string | undefined; label: string } | null {
  const text = msg.text ?? msg.caption ?? '';
  if (!isTicketMessage(text)) return null;
  return { ticketText: text, ...AUTO_SHEET };
}

async function processTicket(
  msg: TelegramMessage,
  ticketText: string,
  sheetId: string | undefined,
  label: string,
) {
  if (!sheetId) {
    await sendMessage(msg.chat.id, '❌ Sheet ID chưa được cấu hình.');
    return;
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
    return;
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

  // Ưu tiên command mode trước, fallback sang auto mode
  const extracted = extractCommandMode(msg) ?? extractAutoMode(msg);
  if (!extracted) return NextResponse.json({ ok: true });

  await processTicket(msg, extracted.ticketText, extracted.sheetId, extracted.label);

  return NextResponse.json({ ok: true });
}
