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

const SHEET = {
  sheetId: process.env.GOOGLE_SHEET_ID_CHUYEN_GIA,
  label: 'Google Sheets Chuyên Gia',
};

const BOT_TOKEN_ENV = 'TELEGRAM_BOT_TOKEN_CHUYEN_GIA';
const SECRET_ENV = 'TELEGRAM_WEBHOOK_SECRET_CHUYEN_GIA';

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
}

interface TelegramCallbackQuery {
  id: string;
  from: { id: number };
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

function getToken(): string {
  return process.env[BOT_TOKEN_ENV]!;
}

function isAllowedId(userId: number): boolean {
  const allowedIds = process.env.ALLOWED_USER_IDS_CHUYEN_GIA ?? process.env.ALLOWED_USER_IDS;
  if (!allowedIds) return true;
  const ids = allowedIds.split(',').map((s) => s.trim());
  return ids.includes(String(userId));
}

function isAllowedSender(msg: TelegramMessage): boolean {
  return isAllowedId(msg.from?.id ?? 0);
}

async function handleCallback(cq: TelegramCallbackQuery) {
  const token = getToken();

  if (!isAllowedId(cq.from.id)) {
    await answerCallbackQuery(cq.id, undefined, token);
    return;
  }

  const logId = cq.data;
  if (!logId) {
    await answerCallbackQuery(cq.id, undefined, token);
    return;
  }

  const pending = await getPendingLog(logId);
  if (!pending) {
    await answerCallbackQuery(cq.id, '❌ Không tìm thấy dữ liệu hoặc đã ghi rồi.', token);
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
    await answerCallbackQuery(cq.id, `✅ Đã ghi ${rowsWritten} booking!`, token);
    if (cq.message) {
      await editMessageText(
        chatId,
        cq.message.message_id,
        buildSuccessMessage(rowsWritten, pending.sheet_id, pending.sheet_label),
        token,
      );
    }
  } else {
    await answerCallbackQuery(cq.id, '❌ Lỗi khi ghi vào Sheet.', token);
  }
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

  if (body.callback_query) {
    await handleCallback(body.callback_query);
    return NextResponse.json({ ok: true });
  }

  const msg = body.message ?? body.channel_post;
  if (!msg) return NextResponse.json({ ok: true });
  if (!isAllowedSender(msg)) return NextResponse.json({ ok: true });

  const text = msg.text ?? msg.caption ?? '';
  if (!text) return NextResponse.json({ ok: true });

  const { sheetId, label } = SHEET;
  const token = getToken();

  if (!sheetId) {
    await sendMessage(msg.chat.id, '❌ Sheet ID chưa được cấu hình.', token);
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
    await sendMessage(msg.chat.id, '❌ Không đọc được thông tin vé. Kiểm tra lại định dạng tin nhắn.', token);
    return NextResponse.json({ ok: true });
  }

  const logId = await logParse({
    raw_message: text,
    parsed_bookings: parseResult.bookings,
    rows_written: 0,
    status: 'pending',
    telegram_message_id: msg.message_id,
    telegram_chat_id: msg.chat.id,
    sheet_id: sheetId,
    sheet_label: label,
  });

  if (!logId) {
    await sendMessage(msg.chat.id, '❌ Lỗi hệ thống, vui lòng thử lại.', token);
    return NextResponse.json({ ok: true });
  }

  await sendMessageWithButton(
    msg.chat.id,
    buildBookingSummary(parseResult.bookings),
    '✅ Ghi vào Drive',
    logId,
    token,
  );

  return NextResponse.json({ ok: true });
}
