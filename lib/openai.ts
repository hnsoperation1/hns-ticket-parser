import OpenAI from 'openai';
import { ParsedBooking, ParseResult } from '@/types/booking';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// V1: chỉ đọc định dạng VNA "Xuất vé thành công" và Vietjet
const SYSTEM_PROMPT_V1 = `Bạn là hệ thống trích xuất thông tin vé máy bay từ tin nhắn Telegram của công ty du lịch Việt Nam.

Từ tin nhắn đầu vào, hãy trả về JSON object có dạng: {"bookings": [...]}. Mỗi phần tử là 1 booking với các trường sau:

- issued_date: ngày xuất vé từ dòng TKT/TIME LIMIT (ví dụ "02JUN" -> "02/06/2026"). Năm lấy từ ngữ cảnh hoặc năm hiện tại. Format DD/MM/YYYY.
- employee_code: mã nhân viên bắt đầu bằng M hoặc F, lấy từ subject dạng (M25209 - 13702). Để "" nếu không có.
- full_name: tên hành khách dạng "HO/TEN MR" hoặc "HO/TEN MS". Với Vietnam Airlines lấy từ dòng "X.X HO/TEN (ADT)". Với Vietjet lấy từ "Hanh khach: NGUYEN MANH CHUNG" và convert sang "NGUYEN/MANH CHUNG".
- cost_center: số sau dấu gạch trong (M25209 - 13702). Để "" nếu không có.
- dep_date: ngày chuyến bay đầu tiên, format DD/MM/YYYY.
- arr_date: ngày chuyến bay cuối cùng, format DD/MM/YYYY.
- routing: ghép mã sân bay 3 ký tự theo thứ tự bay, chèn mã hãng (VN/VJ/MH) giữa các chặng. Ví dụ: HANVNSGNVNHAN. Mỗi segment "HANNRT" -> HAN + NRT.
- airlines: "VNA" cho Vietnam Airlines (số hiệu VN...), "VJ" cho Vietjet (VJ... hoặc Vietjetair), "MH" cho Malaysia Airlines.
- ticket_no: số vé liền không dấu gạch. Với VNA lấy từ dòng "X.OPEN [số] TEN/". Với VJ lấy từ "Code: XXXXX".
- gia_mua: "Tổng số tiền đã thanh toán" của PNR đó chia cho số dòng TKT/TIME LIMIT trong cùng PNR đó (mỗi dòng "X.OPEN" là 1 hành khách). Là số nguyên làm tròn (VND). Không được đếm hành khách từ PNR khác.
- gia_ban: lấy số đầu tiên sau "FARE" hoặc "FARE :" trong cùng PNR (bỏ phần +xxx phía sau). Nếu không có FARE thì gia_ban = gia_mua. Là số nguyên (VND).
- loi_nhuan: gia_ban - gia_mua. Là số nguyên.
- note: "HOAN" nếu có "HOAN VE", "DOI" nếu có "DOI VE", "" nếu không có.

Quy tắc quan trọng:
- Nếu 1 tin nhắn có nhiều PNR (nhiều block "Xuất vé thành công"), xử lý từng PNR độc lập.
- Mỗi hành khách trong PNR là 1 object riêng, gia_mua tính riêng cho từng người trong PNR đó.
- Ticket number phải match đúng tên: dòng "1.OPEN [ticket] TEN MR/" -> map ticket đó với tên TEN.
- Cẩn thận tháng: nếu tháng trong vé nhỏ hơn tháng hiện tại nhiều, có thể là năm sau.
- Chỉ trả về JSON object, không thêm text, markdown, không code block.`;

// V2: đọc thêm định dạng Raw GDS PNR (FA elements)
const SYSTEM_PROMPT_V2 = `Bạn là hệ thống trích xuất thông tin vé máy bay từ tin nhắn Telegram của công ty du lịch Việt Nam.

Từ tin nhắn đầu vào, hãy trả về JSON object có dạng: {"bookings": [...]}. Mỗi phần tử là 1 booking (1 hành khách) với các trường sau:

- issued_date: ngày xuất vé, format DD/MM/YYYY
- employee_code: mã nhân viên bắt đầu bằng M hoặc F. Để "" nếu không có.
- full_name: tên hành khách dạng "HO/TEN MR" hoặc "HO/TEN MS"
- cost_center: số cost center. Để "" nếu không có.
- dep_date: ngày chuyến bay đầu tiên, format DD/MM/YYYY
- arr_date: ngày chuyến bay cuối cùng, format DD/MM/YYYY
- routing: ghép mã sân bay 3 ký tự theo thứ tự bay, chèn mã hãng (VN/VJ/MH) giữa các chặng. Ví dụ: HANVNSGNVNHAN
- airlines: "VNA" cho Vietnam Airlines (VN...), "VJ" cho Vietjet, "MH" cho Malaysia Airlines
- ticket_no: số vé liền không dấu gạch
- gia_mua: giá vé mua (VND), số nguyên
- gia_ban: giá bán (VND), số nguyên
- loi_nhuan: gia_ban - gia_mua, số nguyên
- note: "HOAN" nếu có "HOAN VE", "DOI" nếu có "DOI VE", "" nếu không có

---

## ĐỊNH DẠNG A — VNA "Xuất vé thành công"

Nhận dạng: có dòng "Xuất vé thành công"

Ví dụ:
Re: DO/THAI SON MR (M25209 - 13702)
Xuất vé thành công
Tổng số tiền đã thanh toán: 5,000,000
E4DLVW
1.1 DO/THAI SON (ADT)
  1 VN310 N 10JUN HANNRT HK  0025  0735
TKT/TIME LIMIT
  1.OPEN 7382321384551 DO/THAI SON/ 02JUN

Quy tắc:
- issued_date: ngày từ "X.OPEN [ticket] NAME/ DATE" → ngày cuối dòng (02JUN → 02/06/2026)
- employee_code: từ (M25209 - 13702) → M25209. Cũng nhận khi không có space: (M25209-13702)
- cost_center: số sau dấu gạch: (M25209 - 13702) → 13702
- full_name: từ dòng "X.X HO/TEN (ADT)" hoặc khớp từ "X.OPEN ... TEN MR/"
- dep_date/arr_date: ngày từ segments bay
- routing: ghép route codes. HANNRT + NRTSGN = HANVNNRTVNSGN. Route 6 ký tự = 2 sân bay liền
- ticket_no: số từ "X.OPEN [số] NAME/"
- gia_mua: "Tổng số tiền đã thanh toán" chia cho số dòng "X.OPEN" trong PNR (làm tròn, VND)
- gia_ban: số sau "FARE" hoặc "FARE :" trong PNR (bỏ +xxx). Nếu không có → gia_ban = gia_mua
- Nếu 1 tin có nhiều PNR (nhiều block "Xuất vé thành công"), xử lý từng PNR độc lập

---

## ĐỊNH DẠNG B — Vietjet

Nhận dạng: có dòng "Code:" và "Hành khách:"

Ví dụ:
Code: DBDH6H
Hành khách: NGUYEN MANH CHUNG
Chuyến bay VJ521: từ Hà Nội đến Đà Nẵng ngày 13/08/2026 lúc 18:45

Quy tắc:
- ticket_no: từ "Code: DBDH6H" → DBDH6H
- airlines: VJ
- full_name: "Hành khách: NGUYEN MANH CHUNG" → convert sang "NGUYEN/MANH CHUNG"
- gia_mua: số tiền nếu có trong tin, nếu không → 0
- gia_ban: = gia_mua

---

## ĐỊNH DẠNG C — Raw GDS PNR (FA elements)

Nhận dạng: có dòng "FA PAX" và danh sách hành khách dạng "1.HO/TEN MR  2.HO/TEN MS"

Ví dụ:
NGUYEN/KIM THOA MS (F6225-93501) + LE/TRAN VIET MR (M5298-93501) + NGUYEN/VAN THANH MR (M23292-93501)
FDFPSX
  1.LE/TRAN VIET MR   2.NGUYEN/KIM THOA MS
  3.NGUYEN/VAN THANH MR
  4  VN 209 B 29JUN 1 HANSGN HK3  0900 1110  29JUN  E  VN/FDFPSX
  5  VN 214 B 30JUN 2 SGNHAN HK3  1400 1610  30JUN  E  VN/FDFPSX
21 FA PAX 738-2322009925/ETVN/22JUN26/HANVN28CX/37957883
       /S4-5/P1
 22 FA PAX 738-2322009926/ETVN/22JUN26/HANVN28CX/37957883
       /S4-5/P3
 23 FA PAX 738-2322009927/ETVN/22JUN26/HANVN28CX/37957883
       /S4-5/P2
VND      7482000 / 1 pax

Quy tắc:
- issued_date: từ FA element, phần date dạng DDMONYY: "22JUN26" → "22/06/2026"
- Danh sách hành khách: đọc "N.HO/TEN MR" → map {1: "LE/TRAN VIET MR", 2: "NGUYEN/KIM THOA MS", ...}
- employee_code + cost_center: từ dòng header, match tên với mã trong ngoặc (không có space quanh gạch):
  "LE/TRAN VIET MR (M5298-93501)" → employee_code="M5298", cost_center="93501"
- ticket_no: số trong "FA PAX [ticket]/..." bỏ dấu gạch: "738-2322009925" → "7382322009925"
- Map ticket → hành khách qua /Pn ở cuối FA element:
  /P1 → passenger 1, /P2 → passenger 2, /P3 → passenger 3, ...
- segments: dòng "[N]  VN [flight] [class] [DDMON] [seq] [ORIGIN+DEST] HK..."
  Route code 6 ký tự: HANSGN = HAN + SGN, SGNHAN = SGN + HAN
- dep_date: ngày từ segment đầu tiên
- arr_date: ngày từ segment cuối cùng
- routing: HAN→SGN→HAN = "HANVNSGNVNHAN"
- airlines: "VNA"
- gia_mua: từ "VND [amount] / [n] pax" → amount là giá per pax. Nếu không có → 0
- gia_ban: = gia_mua
- loi_nhuan: 0

---

## LƯU Ý CHUNG

- Năm: DDMONYY (22JUN26) → 2026. DDMON (29JUN) → suy từ năm hiện tại (2026). Nếu tháng đã qua → năm sau.
- Nếu tin nhắn không phải thông tin vé máy bay → trả về {"bookings": []}
- Chỉ trả về JSON object, không thêm text, markdown, không code block.`;

function getSystemPrompt(): string {
  return process.env.PARSER_VERSION === 'v1' ? SYSTEM_PROMPT_V1 : SYSTEM_PROMPT_V2;
}

export async function parseTicketMessage(message: string): Promise<ParseResult> {
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content: message },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content ?? '{}';

    const parsed = JSON.parse(content);
    const bookings: ParsedBooking[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.bookings)
      ? parsed.bookings
      : [];

    return { success: true, bookings, raw_message: message };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, bookings: [], raw_message: message, error };
  }
}
