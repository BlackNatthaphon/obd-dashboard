# BlackTech (React Native)

แอพอ่านค่ารถผ่านตัวเสียบ ELM327 แบบ Bluetooth LE — เขียนด้วย React Native + Expo (TypeScript)

## ฟังก์ชัน
- แดชบอร์ดปรับเองได้หลายหน้า: เพิ่ม/ลบ/ย้าย วิดเจ็ตแบบ ตัวเลข / แถบ / เกจ / กราฟ
- อ่านทุกค่าที่รถรองรับ (ถาม ECU อัตโนมัติ) + ค่าคำนวณ: อัตราสิ้นเปลือง, บูสต์, แรง G, ทริป
- จับเวลา: 0-60, 0-100, 0-400 ม., 0-201 ม., 60-100, 80-120, 100-200, เบรก 100-0 / 60-0 พร้อมไฟเปลี่ยนเกียร์ และ Lap timer
- กราฟสด, อ่าน/ล้างรหัส DTC (บันทึก/รอยืนยัน/ถาวร) พร้อมคำอธิบายภาษาไทย, ความพร้อมระบบตรวจสอบ, VIN
- ธีม 5 แบบ, โหมด HUD (กลับด้านสะท้อนกระจก), บันทึกข้อมูลเป็น CSV แล้วแชร์, โหมดจำลองไว้ลองโดยไม่ต้องต่อรถ
- วิดเจ็ตเกียร์ (N 1 2 3 …): ใช้ PID A4 ถ้ารถส่งมา ไม่งั้นเรียนรู้จากรอบ÷ความเร็วระหว่างขับ, ไฮบริดวิ่งไฟฟ้าขึ้น EV
- วิดเจ็ตรอบเครื่องมีไฟเตือนเปลี่ยนเกียร์ 10 ดวง + ขีดจุดเปลี่ยนเกียร์บนเกจ, เสียงตี๊ดเตือนเปลี่ยนเกียร์ทุกหน้า
- 2 ภาษา: ไทย / English (เลือกได้ในตั้งค่า หรือให้ตามภาษาเครื่อง)

## โครงสร้าง
```
src/
  app/            หน้าจอ (Expo Router) — (tabs)/ แดช จับเวลา ค่าทั้งหมด กราฟ ตรวจเช็ค + settings, hud, log
  obd/            คุยกับตัวเสียบ: catalog.ts (ค่า/สูตร/รหัส), elm.ts (โปรโตคอล), ble.ts (Bluetooth), sim.ts (รถจำลอง)
  core/           engine.ts (เชื่อมต่อ/วนอ่าน/ทริป/บันทึก), race.ts (จับเวลา), settings.ts, values.ts
  ui/             คอมโพเนนต์: Gauge, Chart, WidgetView, TopBar, Sheets, kit
  i18n/           ข้อความแต่ละภาษา: th.ts (หลัก), en.ts
  __tests__/      unit test ของตัวแปลงค่า, ELM, และจับเวลา
plugins/withReleaseSigning.js   เซ็น APK ด้วย credentials/release.keystore (กุญแจเดิม ติดตั้งทับแอพเก่าได้)
```

## เพิ่มภาษาใหม่
1. คัดลอก `src/i18n/en.ts` เป็นไฟล์ใหม่ เช่น `ja.ts` แล้วแปลข้อความ (TypeScript จะเตือนถ้าคีย์ไม่ครบ)
2. เพิ่มใน `DICTS`, `Lang` และ `LANGS` ใน `src/i18n/index.ts`
3. ชื่อค่า OBD และคำอธิบายรหัส DTC อยู่ใน `src/obd/catalog.ts` (ภาษาอื่นนอกจากไทยจะใช้ชื่อภาษาอังกฤษ)

## พัฒนา
```bash
npm install
npm test             # unit test
npm run typecheck
npm run lint
npx expo start --web # ลอง UI ในเบราว์เซอร์ (ใช้ได้แค่โหมดจำลอง)
```
Bluetooth ใช้ native module (`react-native-ble-plx`) จึง**เปิดใน Expo Go ไม่ได้** ต้องใช้ development build:
```bash
npx expo run:android            # ต้องมี Android Studio / Android SDK ในเครื่อง
```

## สร้าง APK
เลือกทางใดทางหนึ่ง:

1. **EAS Build (ไม่ต้องลงอะไรหนัก)** — ต้องมีบัญชี Expo ฟรี
   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest build -p android --profile preview
   ```
   เสร็จแล้วจะได้ลิงก์ดาวน์โหลด APK (เซ็นด้วยกุญแจเดียวกับแอพเก่า ตาม `credentials.json`)
2. **ในเครื่องที่มี Android SDK**
   ```bash
   npm run build:apk    # ได้ไฟล์ android/app/build/outputs/apk/release/app-release.apk
   ```
3. **GitHub Actions** — push เข้า `main` แล้วจะ build และปล่อย APK ในหน้า Releases (ต้องให้บัญชี GitHub ใช้ Actions ได้)

## ติดตั้ง
1. ดาวน์โหลด APK แล้วเปิด
2. อนุญาต "ติดตั้งแอพที่ไม่รู้จัก"
3. เปิดแอพ → อนุญาต "อุปกรณ์ใกล้เคียง" → ติดเครื่องรถ → กด "เชื่อมต่อ"

ปิดแอพ OBD ตัวอื่นก่อน เพราะตัวเสียบรับได้ทีละเครื่อง
