import { google } from 'googleapis';
import { ParsedBooking } from '@/types/booking';

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
      private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function bookingToRow(b: ParsedBooking): string[] {
  return [
    b.issued_date,      // A
    b.employee_code,    // B
    b.full_name,        // C
    b.cost_center,      // D
    b.dep_date,         // E
    b.arr_date,         // F
    b.routing,          // G
    b.airlines,         // H
    b.ticket_no,        // I
    String(b.gia_mua),  // J
    String(b.gia_ban),  // K
    String(b.loi_nhuan),// L
    b.note,             // M
  ];
}

export async function appendBookings(bookings: ParsedBooking[], sheetId: string): Promise<number> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const rows = bookings.map(bookingToRow);

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'A:M',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  return rows.length;
}
