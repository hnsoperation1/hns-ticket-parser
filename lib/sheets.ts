import { google } from 'googleapis';
import { ParsedBooking } from '@/types/booking';

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const SHEET_NAME = 'Sheet1';

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
    b.issued_date,
    b.employee_code,
    b.full_name,
    b.cost_center,
    b.dep_date,
    b.arr_date,
    b.routing,
    b.airlines,
    b.ticket_no,
    b.note,
  ];
}

export async function appendBookings(bookings: ParsedBooking[]): Promise<number> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const rows = bookings.map(bookingToRow);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:J`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  return rows.length;
}
