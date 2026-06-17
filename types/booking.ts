export interface ParsedBooking {
  issued_date: string;    // DD/MM/YYYY
  employee_code: string;  // M25209 | F39884 | ""
  full_name: string;      // HO/TEN MR
  cost_center: string;    // "13702" | ""
  dep_date: string;       // DD/MM/YYYY
  arr_date: string;       // DD/MM/YYYY
  routing: string;        // HANVNSGNVNHAN
  airlines: string;       // VNA | VJ | MH
  ticket_no: string;      // 7382321384551 | DBDH6H
  gia_mua: number;        // Tổng tiền / số người trong PNR
  gia_ban: number;        // FARE nếu có, không thì = gia_mua
  loi_nhuan: number;      // gia_ban - gia_mua
  note: string;           // HOÀN | ĐỔI | ""
}

export interface ParseResult {
  success: boolean;
  bookings: ParsedBooking[];
  raw_message: string;
  error?: string;
}
