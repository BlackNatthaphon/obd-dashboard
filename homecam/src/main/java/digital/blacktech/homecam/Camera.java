package digital.blacktech.homecam;

import android.net.Uri;

import org.json.JSONException;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** One camera. Lives only in memory (decrypted) or inside the encrypted store file. */
public final class Camera {
    public String id = UUID.randomUUID().toString();
    public String name = "";
    public String brand = Brands.CUSTOM;
    public String host = "";
    public int port = 554;
    public String user = "";
    public String pass = "";
    public String mainPath = "";
    public String subPath = "";
    /** ONVIF device service URL, if the camera was found by discovery. */
    public String onvif = "";
    /** RTP over TCP (interleaved): more reliable on Wi-Fi and through VPNs. */
    public boolean tcp = true;

    JSONObject toJson() throws JSONException {
        return new JSONObject()
                .put("id", id).put("name", name).put("brand", brand)
                .put("host", host).put("port", port)
                .put("user", user).put("pass", pass)
                .put("main", mainPath).put("sub", subPath)
                .put("onvif", onvif).put("tcp", tcp);
    }

    static Camera fromJson(JSONObject o) {
        Camera c = new Camera();
        c.id = o.optString("id", c.id);
        c.name = o.optString("name");
        c.brand = o.optString("brand", Brands.CUSTOM);
        c.host = o.optString("host");
        c.port = o.optInt("port", 554);
        c.user = o.optString("user");
        c.pass = o.optString("pass");
        c.mainPath = o.optString("main");
        c.subPath = o.optString("sub");
        c.onvif = o.optString("onvif");
        c.tcp = o.optBoolean("tcp", true);
        return c;
    }

    Camera copy() {
        try {
            return fromJson(toJson());
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    boolean hasSubStream() {
        return !subPath.trim().isEmpty();
    }

    /**
     * Builds the RTSP URL for playback. {@code resolvedHost} is the LAN IP that
     * NetGuard already verified, so the player cannot be pointed elsewhere by DNS.
     * Credentials go in the userinfo part; Media3 strips them from requests and
     * uses them only to answer the camera's Basic/Digest challenge.
     */
    String rtspUri(String resolvedHost, boolean sub) {
        String path = (sub && hasSubStream() ? subPath : mainPath).trim();
        if (!path.startsWith("/")) path = "/" + path;
        String h = resolvedHost.contains(":") && !resolvedHost.startsWith("[")
                ? "[" + resolvedHost + "]" : resolvedHost;
        String auth = user.isEmpty() ? "" : enc(user) + ":" + enc(pass) + "@";
        return "rtsp://" + auth + h + ":" + port + path;
    }

    /** Parses a pasted rtsp://user:pass@host:port/path into this camera. */
    boolean applyRtspUrl(String url) {
        Uri u = Uri.parse(url.trim());
        if (u.getScheme() == null || !u.getScheme().equalsIgnoreCase("rtsp") || u.getHost() == null) {
            return false;
        }
        host = u.getHost();
        port = u.getPort() > 0 ? u.getPort() : 554;
        String ui = u.getUserInfo();
        if (ui != null) {
            int i = ui.indexOf(':');
            user = i < 0 ? ui : ui.substring(0, i);
            pass = i < 0 ? "" : ui.substring(i + 1);
        }
        String p = u.getEncodedPath() == null ? "/" : u.getEncodedPath();
        if (u.getEncodedQuery() != null) p += "?" + u.getEncodedQuery();
        mainPath = p;
        return true;
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, StandardCharsets.UTF_8.name()).replace("+", "%20");
        } catch (java.io.UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }
}
