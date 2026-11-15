package digital.blacktech.homecam;

import android.content.Context;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.util.Base64;
import android.util.Xml;

import org.xmlpull.v1.XmlPullParser;
import org.xmlpull.v1.XmlPullParserException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.StringReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.UUID;

/**
 * Minimal ONVIF client: WS-Discovery to find cameras on Wi-Fi, then
 * GetCapabilities → GetProfiles → GetStreamUri to learn the RTSP links,
 * authenticating with WS-UsernameToken (digest) and HTTP Digest if asked.
 * Passwords are never sent in clear text by this class.
 * All methods block: call them off the main thread.
 */
final class Onvif {
    private Onvif() {}

    static final class Device {
        final String host, xaddr, name;

        Device(String host, String xaddr, String name) {
            this.host = host; this.xaddr = xaddr; this.name = name;
        }
    }

    static final class Streams {
        String main, sub;
    }

    static final class AuthException extends IOException {
        AuthException() { super("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"); }
    }

    private static final SecureRandom RNG = new SecureRandom();

    // ------------------------------------------------------------- discovery

    static List<Device> discover(Context ctx, int timeoutMs) throws IOException {
        WifiManager wm = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        WifiManager.MulticastLock lock = wm != null ? wm.createMulticastLock("homecam-onvif") : null;
        Map<String, Device> found = new LinkedHashMap<>();
        try (DatagramSocket sock = new DatagramSocket()) {
            if (lock != null) {
                lock.setReferenceCounted(false);
                lock.acquire();
            }
            sock.setSoTimeout(400);
            InetAddress group = InetAddress.getByName("239.255.255.250");
            for (String type : new String[]{"dn:NetworkVideoTransmitter", "tds:Device"}) {
                byte[] probe = probe(type).getBytes(StandardCharsets.UTF_8);
                sock.send(new DatagramPacket(probe, probe.length, group, 3702));
            }
            byte[] buf = new byte[65535];
            long end = System.currentTimeMillis() + timeoutMs;
            while (System.currentTimeMillis() < end) {
                DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                try {
                    sock.receive(pkt);
                } catch (SocketTimeoutException e) {
                    continue;
                }
                if (!NetGuard.isLocal(pkt.getAddress())) continue;
                String host = pkt.getAddress().getHostAddress();
                if (found.containsKey(host)) continue;
                try {
                    Node root = parse(new String(pkt.getData(), 0, pkt.getLength(), StandardCharsets.UTF_8));
                    Node match = root.find("ProbeMatch");
                    if (match == null) continue;
                    String xaddr = pickXaddr(match.findText("XAddrs"), host);
                    found.put(host, new Device(host, xaddr, scopeName(match.findText("Scopes"))));
                } catch (IOException ignored) {
                    // Not a parsable ONVIF reply; skip it.
                }
            }
        } finally {
            if (lock != null && lock.isHeld()) lock.release();
        }
        return new ArrayList<>(found.values());
    }

    private static String probe(String type) {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
            + "<e:Envelope xmlns:e=\"http://www.w3.org/2003/05/soap-envelope\""
            + " xmlns:w=\"http://schemas.xmlsoap.org/ws/2004/08/addressing\""
            + " xmlns:d=\"http://schemas.xmlsoap.org/ws/2005/04/discovery\""
            + " xmlns:dn=\"http://www.onvif.org/ver10/network/wsdl\""
            + " xmlns:tds=\"http://www.onvif.org/ver10/device/wsdl\">"
            + "<e:Header><w:MessageID>uuid:" + UUID.randomUUID() + "</w:MessageID>"
            + "<w:To e:mustUnderstand=\"true\">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>"
            + "<w:Action e:mustUnderstand=\"true\">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>"
            + "</e:Header><e:Body><d:Probe><d:Types>" + type + "</d:Types></d:Probe></e:Body></e:Envelope>";
    }

    /** Prefers an http XAddr; always points it at the host that actually answered. */
    private static String pickXaddr(String xaddrs, String host) {
        String best = null;
        if (xaddrs != null) {
            for (String x : xaddrs.trim().split("\\s+")) {
                if (x.startsWith("http://") || x.startsWith("https://")) {
                    best = x;
                    if (Uri.parse(x).getHost() != null && !Uri.parse(x).getHost().contains(":")) break;
                }
            }
        }
        return best == null ? "http://" + host + "/onvif/device_service" : withHost(best, host);
    }

    private static String scopeName(String scopes) {
        String name = null, hw = null;
        if (scopes != null) {
            for (String s : scopes.trim().split("\\s+")) {
                if (s.startsWith("onvif://www.onvif.org/name/")) name = decode(s.substring(27));
                else if (s.startsWith("onvif://www.onvif.org/hardware/")) hw = decode(s.substring(31));
            }
        }
        if (name != null && hw != null && !name.equalsIgnoreCase(hw)) return name + " (" + hw + ")";
        return name != null ? name : hw != null ? hw : "กล้อง ONVIF";
    }

    private static String decode(String s) {
        try {
            return URLDecoder.decode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    // ------------------------------------------------------------- stream URIs

    /**
     * Asks the camera for its RTSP links. {@code host} is the address the user
     * gave/selected; any host the camera reports back is replaced with it.
     */
    static Streams fetchStreams(String host, String xaddr, String user, String pass) throws IOException {
        String ip = NetGuard.resolveLocal(host);
        String device = xaddr == null || xaddr.isEmpty()
                ? "http://" + bracket(ip) + "/onvif/device_service" : withHost(xaddr, ip);

        long skew = clockSkew(device);

        String caps = call(device, user, pass, skew,
            "<tds:GetCapabilities xmlns:tds=\"http://www.onvif.org/ver10/device/wsdl\">"
            + "<tds:Category>Media</tds:Category></tds:GetCapabilities>");
        Node media = parse(caps).find("Media");
        String mediaX = media != null ? media.findText("XAddr") : null;
        mediaX = mediaX == null ? device : withHost(mediaX.trim(), ip);

        Node profiles = parse(call(mediaX, user, pass, skew,
            "<trt:GetProfiles xmlns:trt=\"http://www.onvif.org/ver10/media/wsdl\"/>"));
        List<String> tokens = new ArrayList<>();
        for (Node p : profiles.findAll("Profiles")) {
            String t = p.attrs.get("token");
            if (t != null && !t.isEmpty()) tokens.add(t);
        }
        if (tokens.isEmpty()) throw new IOException("กล้องไม่ได้ส่งรายการสตรีมมา");

        Streams s = new Streams();
        s.main = streamUri(mediaX, user, pass, skew, tokens.get(0), ip);
        if (tokens.size() > 1) {
            try {
                s.sub = streamUri(mediaX, user, pass, skew, tokens.get(1), ip);
            } catch (IOException ignored) {
                // Sub stream is optional.
            }
        }
        return s;
    }

    private static String streamUri(String mediaX, String user, String pass, long skew,
                                    String token, String ip) throws IOException {
        String body = "<trt:GetStreamUri xmlns:trt=\"http://www.onvif.org/ver10/media/wsdl\""
            + " xmlns:tt=\"http://www.onvif.org/ver10/schema\"><trt:StreamSetup>"
            + "<tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol>"
            + "</tt:Transport></trt:StreamSetup><trt:ProfileToken>" + esc(token)
            + "</trt:ProfileToken></trt:GetStreamUri>";
        String uri = parse(call(mediaX, user, pass, skew, body)).findText("Uri");
        if (uri == null || !uri.trim().toLowerCase(Locale.ROOT).startsWith("rtsp")) {
            throw new IOException("กล้องไม่ได้ส่งลิงก์ RTSP มา");
        }
        return withHost(uri.trim(), ip);
    }

    /** Camera clock minus phone clock, in ms. WS-Security digests are time-stamped. */
    private static long clockSkew(String device) {
        try {
            Node r = parse(call(device, null, null, 0,
                "<tds:GetSystemDateAndTime xmlns:tds=\"http://www.onvif.org/ver10/device/wsdl\"/>"));
            Node utc = r.find("UTCDateTime");
            if (utc == null) return 0;
            Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
            c.clear();
            c.set(Integer.parseInt(utc.findText("Year").trim()),
                  Integer.parseInt(utc.findText("Month").trim()) - 1,
                  Integer.parseInt(utc.findText("Day").trim()),
                  Integer.parseInt(utc.findText("Hour").trim()),
                  Integer.parseInt(utc.findText("Minute").trim()),
                  Integer.parseInt(utc.findText("Second").trim()));
            return c.getTimeInMillis() - System.currentTimeMillis();
        } catch (Exception e) {
            return 0;
        }
    }

    // ------------------------------------------------------------- SOAP / HTTP

    private static String call(String url, String user, String pass, long skew, String body)
            throws IOException {
        boolean auth = user != null && !user.isEmpty();
        String env = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
            + "<s:Envelope xmlns:s=\"http://www.w3.org/2003/05/soap-envelope\">"
            + (auth ? wsSecurity(user, pass, skew) : "")
            + "<s:Body>" + body + "</s:Body></s:Envelope>";

        Resp r = post(url, env, null);
        if (r.code == 401 && auth && r.challenge != null
                && r.challenge.regionMatches(true, 0, "Digest", 0, 6)) {
            r = post(url, env, httpDigest(r.challenge, url, user, pass));
        }
        if (r.code == 401 || r.code == 403) throw new AuthException();
        if (r.code >= 400) {
            String reason = null;
            try {
                Node f = parse(r.body).find("Fault");
                if (f != null) reason = f.findText("Text");
                if (f != null && (r.body.contains("NotAuthorized") || r.body.contains("FailedAuthentication"))) {
                    throw new AuthException();
                }
            } catch (AuthException e) {
                throw e;
            } catch (IOException ignored) {
            }
            throw new IOException("กล้องตอบกลับผิดพลาด (HTTP " + r.code + ")"
                    + (reason != null ? ": " + reason.trim() : ""));
        }
        return r.body;
    }

    private static String wsSecurity(String user, String pass, long skew) {
        byte[] nonce = new byte[16];
        RNG.nextBytes(nonce);
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        String created = f.format(new Date(System.currentTimeMillis() + skew));
        byte[] c = created.getBytes(StandardCharsets.UTF_8);
        byte[] p = pass.getBytes(StandardCharsets.UTF_8);
        byte[] all = new byte[nonce.length + c.length + p.length];
        System.arraycopy(nonce, 0, all, 0, nonce.length);
        System.arraycopy(c, 0, all, nonce.length, c.length);
        System.arraycopy(p, 0, all, nonce.length + c.length, p.length);
        String digest = Base64.encodeToString(hash("SHA-1", all), Base64.NO_WRAP);
        return "<s:Header><Security s:mustUnderstand=\"1\" xmlns=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd\">"
            + "<UsernameToken><Username>" + esc(user) + "</Username>"
            + "<Password Type=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest\">"
            + digest + "</Password>"
            + "<Nonce EncodingType=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary\">"
            + Base64.encodeToString(nonce, Base64.NO_WRAP) + "</Nonce>"
            + "<Created xmlns=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd\">"
            + created + "</Created></UsernameToken></Security></s:Header>";
    }

    /** RFC 2617/7616 Digest (MD5, qop=auth). */
    private static String httpDigest(String challenge, String url, String user, String pass) {
        Map<String, String> p = new HashMap<>();
        java.util.regex.Matcher m = java.util.regex.Pattern
            .compile("(\\w+)=(?:\"([^\"]*)\"|([^,\\s]+))").matcher(challenge.substring(6));
        while (m.find()) p.put(m.group(1).toLowerCase(Locale.ROOT), m.group(2) != null ? m.group(2) : m.group(3));
        String realm = p.getOrDefault("realm", ""), nonce = p.getOrDefault("nonce", "");
        String qop = p.get("qop");
        URL u;
        try {
            u = new URL(url);
        } catch (IOException e) {
            throw new IllegalArgumentException(e);
        }
        String uri = u.getFile().isEmpty() ? "/" : u.getFile();
        String ha1 = md5(user + ":" + realm + ":" + pass);
        String ha2 = md5("POST:" + uri);
        StringBuilder h = new StringBuilder("Digest username=\"").append(user.replace("\"", ""))
            .append("\", realm=\"").append(realm).append("\", nonce=\"").append(nonce)
            .append("\", uri=\"").append(uri).append("\", algorithm=MD5");
        if (qop != null && qop.contains("auth")) {
            byte[] cn = new byte[8];
            RNG.nextBytes(cn);
            String cnonce = hex(cn), nc = "00000001";
            h.append(", qop=auth, nc=").append(nc).append(", cnonce=\"").append(cnonce)
             .append("\", response=\"").append(md5(ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":auth:" + ha2)).append('"');
        } else {
            h.append(", response=\"").append(md5(ha1 + ":" + nonce + ":" + ha2)).append('"');
        }
        if (p.containsKey("opaque")) h.append(", opaque=\"").append(p.get("opaque")).append('"');
        return h.toString();
    }

    private static final class Resp {
        int code;
        String body = "", challenge;
    }

    private static Resp post(String url, String body, String authHeader) throws IOException {
        URL u = new URL(url);
        if (!"http".equals(u.getProtocol()) && !"https".equals(u.getProtocol())) {
            throw new IOException("ที่อยู่ ONVIF ไม่ถูกต้อง");
        }
        NetGuard.resolveLocal(u.getHost());
        HttpURLConnection c = (HttpURLConnection) u.openConnection();
        try {
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(5000);
            c.setReadTimeout(8000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/soap+xml; charset=utf-8");
            if (authHeader != null) c.setRequestProperty("Authorization", authHeader);
            byte[] data = body.getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = c.getOutputStream()) {
                os.write(data);
            }
            Resp r = new Resp();
            r.code = c.getResponseCode();
            r.challenge = c.getHeaderField("WWW-Authenticate");
            InputStream in = r.code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) {
                try (InputStream is = in) {
                    r.body = readCapped(is, 1 << 20);
                }
            }
            return r;
        } catch (java.net.ConnectException | SocketTimeoutException e) {
            throw new IOException("ติดต่อกล้องไม่ได้ (" + u.getHost() + ") — กล้องอาจไม่ได้เปิด ONVIF");
        } finally {
            c.disconnect();
        }
    }

    private static String readCapped(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[8192];
        int n;
        while ((n = in.read(b)) > 0) {
            out.write(b, 0, n);
            if (out.size() > max) throw new IOException("คำตอบจากกล้องใหญ่ผิดปกติ");
        }
        return out.toString("UTF-8");
    }

    // ------------------------------------------------------------- helpers

    static String withHost(String url, String ip) {
        Uri u = Uri.parse(url);
        if (u.getScheme() == null) return url;
        String port = u.getPort() > 0 ? ":" + u.getPort() : "";
        String rest = u.getEncodedPath() == null ? "" : u.getEncodedPath();
        if (u.getEncodedQuery() != null) rest += "?" + u.getEncodedQuery();
        return u.getScheme() + "://" + bracket(ip) + port + rest;
    }

    private static String bracket(String ip) {
        return ip.contains(":") && !ip.startsWith("[") ? "[" + ip + "]" : ip;
    }

    private static String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&apos;");
    }

    private static byte[] hash(String alg, byte[] in) {
        try {
            return MessageDigest.getInstance(alg).digest(in);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String md5(String s) {
        return hex(hash("MD5", s.getBytes(StandardCharsets.UTF_8)));
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }

    // ------------------------------------------------------------- tiny XML tree

    static final class Node {
        final String name;
        final Map<String, String> attrs = new HashMap<>();
        final List<Node> kids = new ArrayList<>();
        final StringBuilder text = new StringBuilder();

        Node(String name) { this.name = name; }

        Node find(String local) {
            ArrayDeque<Node> q = new ArrayDeque<>();
            q.add(this);
            while (!q.isEmpty()) {
                Node n = q.poll();
                if (n.name.equals(local)) return n;
                q.addAll(n.kids);
            }
            return null;
        }

        List<Node> findAll(String local) {
            List<Node> out = new ArrayList<>();
            ArrayDeque<Node> q = new ArrayDeque<>();
            q.add(this);
            while (!q.isEmpty()) {
                Node n = q.poll();
                if (n.name.equals(local)) out.add(n);
                q.addAll(n.kids);
            }
            return out;
        }

        String findText(String local) {
            Node n = find(local);
            return n == null ? null : n.text.toString();
        }
    }

    /** Namespace-aware pull parser; no DTDs or external entities are processed. */
    static Node parse(String xml) throws IOException {
        if (xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY")) {
            throw new IOException("ไม่รับ XML ที่มี DOCTYPE");   // no entity-expansion tricks
        }
        try {
            XmlPullParser p = Xml.newPullParser();
            p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true);
            p.setInput(new StringReader(xml));
            Node root = new Node("#doc");
            ArrayDeque<Node> stack = new ArrayDeque<>();
            stack.push(root);
            int depth = 0;
            for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                if (ev == XmlPullParser.START_TAG) {
                    if (++depth > 64) throw new IOException("XML ซ้อนลึกเกินไป");
                    Node n = new Node(p.getName());
                    for (int i = 0; i < p.getAttributeCount(); i++) n.attrs.put(p.getAttributeName(i), p.getAttributeValue(i));
                    stack.peek().kids.add(n);
                    stack.push(n);
                } else if (ev == XmlPullParser.END_TAG) {
                    depth--;
                    stack.pop();
                } else if (ev == XmlPullParser.TEXT) {
                    stack.peek().text.append(p.getText());
                }
            }
            return root;
        } catch (XmlPullParserException e) {
            throw new IOException("อ่านคำตอบจากกล้องไม่ได้");
        }
    }
}
