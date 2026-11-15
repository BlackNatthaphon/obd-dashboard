package digital.blacktech.homecam;

/** RTSP path presets for brands common in Thailand. */
final class Brands {
    private Brands() {}

    static final String CUSTOM = "custom";

    static final class Brand {
        final String id, label, main, sub, user, hint;
        final int port;

        Brand(String id, String label, int port, String main, String sub, String user, String hint) {
            this.id = id; this.label = label; this.port = port;
            this.main = main; this.sub = sub; this.user = user; this.hint = hint;
        }

        @Override public String toString() { return label; }
    }

    static final Brand[] ALL = {
        new Brand(CUSTOM, "อื่นๆ / ONVIF / กำหนดเอง", 554, "", "", "",
            "กด \"ค้นหากล้องใน Wi-Fi\" แล้ว \"ดึงลิงก์อัตโนมัติ\" (กล้องต้องรองรับ ONVIF) "
            + "หรือวางลิงก์ rtsp:// เต็มในช่อง IP ก็ได้"),
        new Brand("tapo", "TP-Link Tapo / VIGI", 554, "/stream1", "/stream2", "",
            "ในแอป Tapo: เลือกกล้อง > ⚙ > ตั้งค่าขั้นสูง > บัญชีกล้อง แล้วตั้งชื่อผู้ใช้/รหัสผ่าน "
            + "ใช้ค่านั้นที่นี่ (ไม่ใช่รหัสบัญชี TP-Link)"),
        new Brand("hikvision", "Hikvision / HiLook", 554,
            "/Streaming/Channels/101", "/Streaming/Channels/102", "admin",
            "ชื่อผู้ใช้มักเป็น admin รหัสผ่านคือรหัสที่ตั้งตอนเปิดใช้งานกล้อง"),
        new Brand("ezviz", "EZVIZ", 554,
            "/Streaming/Channels/101", "/Streaming/Channels/102", "admin",
            "ชื่อผู้ใช้ admin รหัสผ่าน = Verification Code 6 ตัวบนสติกเกอร์กล้อง "
            + "บางรุ่นต้องเปิด RTSP / LAN Live View ในแอป EZVIZ ก่อน"),
        new Brand("dahua", "Dahua / Imou", 554,
            "/cam/realmonitor?channel=1&subtype=0", "/cam/realmonitor?channel=1&subtype=1", "admin",
            "Imou: ชื่อผู้ใช้ admin รหัสผ่าน = Safety Code บนสติกเกอร์กล้อง "
            + "Dahua: ใช้รหัสที่ตั้งไว้"),
        new Brand("reolink", "Reolink", 554, "/h264Preview_01_main", "/h264Preview_01_sub", "admin",
            "เปิด RTSP ในแอป Reolink: ตั้งค่า > เครือข่าย > ตั้งค่าพอร์ตขั้นสูง"),
        new Brand("uniview", "Uniview (UNV)", 554, "/unicast/c1/s0/live", "/unicast/c1/s1/live", "admin",
            "ใช้บัญชี admin ของกล้อง"),
        new Brand("v380", "V380", 554, "/live/ch00_0", "/live/ch00_1", "admin",
            "ต้องเปิด RTSP/ONVIF ในแอป V380 ก่อน (บางรุ่นไม่รองรับ)"),
        new Brand("yoosee", "Yoosee", 554, "/onvif1", "/onvif2", "admin",
            "ชื่อผู้ใช้ admin รหัสผ่าน = รหัสกล้องที่ตั้งในแอป Yoosee"),
    };

    static Brand byId(String id) {
        for (Brand b : ALL) if (b.id.equals(id)) return b;
        return ALL[0];
    }

    static int indexOf(String id) {
        for (int i = 0; i < ALL.length; i++) if (ALL[i].id.equals(id)) return i;
        return 0;
    }
}
