import { ParsedBooking } from '@/types/booking';

function getSheetUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}`;
}

export async function sendMessage(
  chatId: number,
  text: string,
  token = process.env.TELEGRAM_BOT_TOKEN!,
) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

export async function sendMessageWithButton(
  chatId: number,
  text: string,
  buttonText: string,
  callbackData: string,
  token = process.env.TELEGRAM_BOT_TOKEN!,
) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: buttonText, callback_data: callbackData }]],
      },
    }),
  });
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  token = process.env.TELEGRAM_BOT_TOKEN!,
) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  token = process.env.TELEGRAM_BOT_TOKEN!,
) {
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' }),
  });
}

export function buildSuccessMessage(rowsWritten: number, sheetId: string, label: string): string {
  return (
    `✅ Đã ghi ${rowsWritten} booking vào ${label}.\n` +
    `📋 <a href="${getSheetUrl(sheetId)}">Mở ${label}</a>`
  );
}

export function buildBookingSummary(bookings: ParsedBooking[]): string {
  const rows = bookings
    .map((b) =>
      [
        b.issued_date, b.employee_code, b.full_name, b.cost_center,
        b.dep_date, b.arr_date, b.routing, b.airlines, b.ticket_no,
        b.gia_mua, b.gia_ban, b.loi_nhuan, b.note,
      ].join(' | ')
    )
    .join('\n');

  return [
    `📋 Em đọc được <b>${bookings.length} booking</b>, chị kiểm tra giúp em ạ:`,
    '',
    `<pre>${rows}</pre>`,
    '',
    'Dạ nếu thông tin đúng chị bấm nút "Ghi vào Drive" giúp em ạ!',
  ].join('\n');
}
