# OBD Dashboard (Android)

แอพ Android อ่านค่ารถผ่านตัวเสียบ ELM327 แบบ Bluetooth LE

- หน้าจอ: `app/src/main/assets/index.html` (ใช้เปิดใน Chrome ผ่าน Web Bluetooth ได้ด้วย)
- Bluetooth: `MainActivity.java` (native BLE bridge → `window.AndroidBle`)
- ทุกครั้งที่ push เข้า `main` GitHub Actions จะ build APK แล้วปล่อยไว้ในหน้า **Releases**

## ติดตั้ง
1. ดาวน์โหลด `obd-dashboard.apk` จาก Releases ล่าสุด
2. อนุญาต "ติดตั้งแอพที่ไม่รู้จัก" ให้เบราว์เซอร์/ไฟล์
3. เปิดแอพ → อนุญาต "อุปกรณ์ใกล้เคียง" → ติดเครื่องรถ → กด "เชื่อมต่อ"

ปิดแอพ OBD ตัวอื่นก่อน เพราะตัวเสียบรับได้ทีละเครื่อง
