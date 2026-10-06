// เขียนไฟล์ CSV ลงแคชแล้วเปิดเมนูแชร์ (บันทึกลงไฟล์ / ส่ง LINE / อีเมล ฯลฯ)
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function exportCsv(name: string, text: string) {
  const f = new File(Paths.cache, name);
  f.create({overwrite: true});
  f.write(text);
  await Sharing.shareAsync(f.uri, {mimeType: 'text/csv', dialogTitle: name});
}
