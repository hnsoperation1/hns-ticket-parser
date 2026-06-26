import { NextRequest, NextResponse } from 'next/server';
import { parseTicketMessage } from '@/lib/openai';
import { appendBookings } from '@/lib/sheets';
import { logParse, getPendingLog, updateLogWritten } from '@/lib/supabase';
import {
  sendMessage,
  sendMessageWithButton,
  answerCallbackQuery,
  editMessageText,
  buildSuccessMessage,
  buildBookingSummary,
} from '@/lib/telegram';

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
  callback_query?: TelegramCallbackQuery;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  from?: { id: number; username?: string };
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
}

interface TelegramCallbackQuery {
  id: string;
  from: { id: number };
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

function isAllowedId(userId: number): boolean {
  const allowedIds = process.env.ALLOWED_USER_IDS;
  if (!allowedIds) return true;
  const ids = allowedIds.split(',').map((s) => s.trim());
  return ids.includes(String(userId));
}

function isAllowedSender(msg: TelegramMessage): boolean {
  return isAllowedId(msg.from?.id ?? 0);
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
  if (!text) return null;
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

  const logId = await logParse({
    raw_message: ticketText,
    parsed_bookings: parseResult.bookings,
    rows_written: 0,
    status: 'pending',
    telegram_message_id: msg.message_id,
    telegram_chat_id: msg.chat.id,
    sheet_id: sheetId,
    sheet_label: label,
  });

  if (!logId) {
    await sendMessage(msg.chat.id, '❌ Lỗi hệ thống, vui lòng thử lại.');
    return;
  }

  await sendMessageWithButton(
    msg.chat.id,
    buildBookingSummary(parseResult.bookings),
    '✅ Ghi vào Drive',
    logId,
  );
}

async function handleCallback(cq: TelegramCallbackQuery) {
  if (!isAllowedId(cq.from.id)) {
    await answerCallbackQuery(cq.id);
    return;
  }

  const logId = cq.data;
  if (!logId) {
    await answerCallbackQuery(cq.id);
    return;
  }

  const pending = await getPendingLog(logId);
  if (!pending) {
    await answerCallbackQuery(cq.id, '❌ Không tìm thấy dữ liệu hoặc đã ghi rồi.');
    return;
  }

  let rowsWritten = 0;
  let status: 'success' | 'error' | 'partial' = 'success';
  let errorMessage: string | undefined;

  try {
    rowsWritten = await appendBookings(pending.parsed_bookings, pending.sheet_id);
  } catch (err) {
    status = 'partial';
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  await updateLogWritten(logId, rowsWritten, status, errorMessage);

  const chatId = cq.message?.chat.id ?? pending.telegram_chat_id;

  if (status === 'success') {
    await answerCallbackQuery(cq.id, `✅ Đã ghi ${rowsWritten} booking!`);
    if (cq.message) {
      await editMessageText(
        chatId,
        cq.message.message_id,
        buildSuccessMessage(rowsWritten, pending.sheet_id, pending.sheet_label),
      );
    }
  } else {
    await answerCallbackQuery(cq.id, '❌ Lỗi khi ghi vào Sheet.');
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

  if (body.callback_query) {
    await handleCallback(body.callback_query);
    return NextResponse.json({ ok: true });
  }

  const msg = body.message ?? body.channel_post;
  if (!msg) return NextResponse.json({ ok: true });
  if (!isAllowedSender(msg)) return NextResponse.json({ ok: true });

  // Ưu tiên command mode trước, fallback sang auto mode
  const extracted = extractCommandMode(msg) ?? extractAutoMode(msg);
  if (!extracted) return NextResponse.json({ ok: true });

  await processTicket(msg, extracted.ticketText, extracted.sheetId, extracted.label);

  return NextResponse.json({ ok: true });
}
