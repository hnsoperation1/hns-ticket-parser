const SHEET_URL = 'https://docs.google.com/spreadsheets/d/14wfqEsVxOIaLNkQ-hZCpSFXAo8mhsrohXwMZ6deU-uQ';

export async function sendMessage(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

export function buildSuccessMessage(rowsWritten: number): string {
  return (
    `✅ Đã ghi <b>${rowsWritten} booking</b> vào Google Sheets thành công!\n\n` +
    `📋 Xem tại: ${SHEET_URL}`
  );
}
