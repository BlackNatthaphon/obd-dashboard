package digital.blacktech.homecam;

import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;

/**
 * The app only ever talks to devices on the home network (or reached through a
 * VPN into it). Cameras speak unencrypted RTSP/HTTP, so this keeps video and
 * login exchanges off the public internet, and stops a typo or a malicious
 * hostname from sending camera credentials somewhere else.
 */
final class NetGuard {
    private NetGuard() {}

    static boolean isLocal(InetAddress a) {
        if (a.isLoopbackAddress() || a.isSiteLocalAddress() || a.isLinkLocalAddress()) return true;
        byte[] b = a.getAddress();
        if (b.length == 4) {
            int b0 = b[0] & 0xff, b1 = b[1] & 0xff;
            return b0 == 100 && b1 >= 64 && b1 <= 127;      // 100.64/10: CGNAT, Tailscale
        }
        return b.length == 16 && (b[0] & 0xfe) == 0xfc;     // fc00::/7: IPv6 ULA
    }

    /**
     * Resolves {@code host} (blocking — never call on the main thread) and returns
     * an IP literal to connect to. Every address the name resolves to must be local.
     */
    static String resolveLocal(String host) throws IOException {
        if (host == null || host.trim().isEmpty()) throw new IOException("ยังไม่ได้ใส่ IP ของกล้อง");
        InetAddress[] all;
        try {
            all = InetAddress.getAllByName(host.trim());
        } catch (IOException e) {
            throw new IOException("หาที่อยู่ \"" + host + "\" ไม่เจอ");
        }
        InetAddress pick = null;
        for (InetAddress a : all) {
            if (!isLocal(a)) {
                throw new IOException("เพื่อความปลอดภัย แอปเชื่อมต่อได้เฉพาะกล้องในเครือข่ายบ้าน "
                        + "(Wi-Fi/LAN หรือ VPN เข้าบ้าน) เท่านั้น — " + a.getHostAddress()
                        + " เป็นที่อยู่บนอินเทอร์เน็ต");
            }
            if (pick == null || (a instanceof Inet4Address && !(pick instanceof Inet4Address))) pick = a;
        }
        if (pick == null) throw new IOException("หาที่อยู่ \"" + host + "\" ไม่เจอ");
        String ip = pick.getHostAddress();
        int scope = ip.indexOf('%');            // drop IPv6 zone id; not valid in a URL as-is
        return scope >= 0 ? ip.substring(0, scope) : ip;
    }
}
