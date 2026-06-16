function getSheetUrl(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  return `https://docs.google.com/spreadsheets/d/${id}`;
}

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
    `✅ Xuất vé thành công!\n` +
    `Đã ghi <b>${rowsWritten} booking</b> vào Google Sheets.\n\n` +
    `📋 <a href="${getSheetUrl()}">Mở Google Sheets</a>`
  );
}
