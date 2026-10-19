// เวอร์ชันเว็บ: ดาวน์โหลดไฟล์ตรงๆ
export async function exportCsv(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type: 'text/csv'}));
  a.download = name;
  a.click();
}
