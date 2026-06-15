import OpenAI from 'openai';
import { ParsedBooking, ParseResult } from '@/types/booking';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `Bạn là hệ thống trích xuất thông tin vé máy bay từ tin nhắn Telegram của công ty du lịch Việt Nam.

Từ tin nhắn đầu vào, hãy trả về JSON array. Mỗi phần tử là 1 booking với các trường sau:

- issued_date: ngày xuất vé từ dòng TKT/TIME LIMIT (ví dụ "02JUN" → "02/06/2026"). Năm lấy từ ngữ cảnh hoặc năm hiện tại. Format DD/MM/YYYY.
- employee_code: mã nhân viên bắt đầu bằng M hoặc F, lấy từ subject dạng (M25209 - 13702). Để "" nếu không có.
- full_name: tên hành khách dạng "HO/TEN MR" hoặc "HO/TEN MS". Với Vietnam Airlines lấy từ dòng "X.X HO/TEN (ADT)". Với Vietjet lấy từ "Hành khách: NGUYEN MANH CHUNG" và convert sang "NGUYEN/MANH CHUNG".
- cost_center: số sau dấu gạch trong (M25209 - 13702). Để "" nếu không có.
- dep_date: ngày chuyến bay đầu tiên, format DD/MM/YYYY.
- arr_date: ngày chuyến bay cuối cùng, format DD/MM/YYYY.
- routing: ghép mã sân bay 3 ký tự theo thứ tự bay, chèn mã hãng (VN/VJ/MH) giữa các chặng. Ví dụ: HANVNSGNVNHAN. Mỗi segment "HANNRT" → HAN + NRT.
- airlines: "VNA" cho Vietnam Airlines (số hiệu VN...), "VJ" cho Vietjet (VJ... hoặc Vietjetair), "MH" cho Malaysia Airlines.
- ticket_no: số vé liền không dấu gạch. Với VNA lấy từ dòng "X.OPEN [số] TEN/". Với VJ lấy từ "Code: XXXXX".
- note: "HOÀN" nếu có "HOÀN VÉ", "ĐỔI" nếu có "ĐỔI VÉ", "" nếu không có.

Quy tắc quan trọng:
- Nếu 1 tin nhắn có nhiều hành khách, trả về nhiều object trong array.
- Ticket number phải match đúng tên: dòng "1.OPEN [ticket] TEN MR/" → map ticket đó với tên TEN.
- Cẩn thận tháng: nếu tháng trong vé nhỏ hơn tháng hiện tại nhiều, có thể là năm sau.
- Trả về JSON object có dạng: {"bookings": [...]}. Không thêm text, không markdown, không code block.`;

export async function parseTicketMessage(message: string): Promise<ParseResult> {
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content ?? '{}';

    // GPT với json_object mode trả về object, ta wrap nếu cần
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
