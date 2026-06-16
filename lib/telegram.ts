function getSheetUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}`;
}

export async function sendMessage(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

export function buildSuccessMessage(rowsWritten: number, sheetId: string): string {
  return (
    `✅ Đã ghi ${rowsWritten} booking vào Google Sheets.\n` +
    `📋 <a href="${getSheetUrl(sheetId)}">Mở Google Sheets</a>`
  );
}
