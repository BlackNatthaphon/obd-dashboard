package digital.blacktech.obd;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * WebView UI (assets/index.html) + native Bluetooth LE bridge for ELM327 BLE dongles.
 * JS calls window.AndroidBle.connect()/write()/disconnect()/forget();
 * native calls back window.__ble.status/connected/data/error/disconnected.
 */
@SuppressLint("MissingPermission")
public class MainActivity extends Activity {

    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final int REQ_PERM = 1;
    private static final int REQ_ENABLE_BT = 2;
    private static final int REQ_SAVE = 3;
    private static final long SCAN_MS = 5000;

    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private BluetoothAdapter adapter;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic rxChar, txChar;
    private final ArrayDeque<byte[]> writeQueue = new ArrayDeque<>();
    private boolean writing = false;
    private boolean ready = false;
    private boolean fromSaved = false;
    private SharedPreferences prefs;
    private String saveText, saveName;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.parseColor("#0d1117"));
        getWindow().setNavigationBarColor(Color.parseColor("#0d1117"));

        prefs = getSharedPreferences("obd", MODE_PRIVATE);
        BluetoothManager bm = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
        adapter = bm != null ? bm.getAdapter() : null;

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0d1117"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "AndroidBle");
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
    }

    @Override
    protected void onDestroy() {
        closeGatt();
        super.onDestroy();
    }

    // ---------------- JS bridge ----------------
    class Bridge {
        @JavascriptInterface
        public void connect() { ui.post(MainActivity.this::startConnect); }

        @JavascriptInterface
        public void write(String text) {
            byte[] data = text.getBytes(StandardCharsets.US_ASCII);
            ui.post(() -> {
                for (int i = 0; i < data.length; i += 20) {
                    int end = Math.min(data.length, i + 20);
                    byte[] chunk = new byte[end - i];
                    System.arraycopy(data, i, chunk, 0, chunk.length);
                    writeQueue.add(chunk);
                }
                pumpWrites();
            });
        }

        @JavascriptInterface
        public void disconnect() { ui.post(() -> { closeGatt(); js("disconnected", null); }); }

        @JavascriptInterface
        public void forget() { prefs.edit().remove("addr").apply(); }

        @JavascriptInterface
        public String savedName() { return prefs.getString("name", ""); }

        @JavascriptInterface
        public void openUrl(String url) {
            if (!url.startsWith("https://")) return;
            ui.post(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
                catch (Exception e) { js("error", "เปิดลิงก์ไม่ได้"); }
            });
        }

        // บันทึกไฟล์ (เช่น CSV) ให้ผู้ใช้เลือกที่เก็บเอง
        @JavascriptInterface
        public void saveFile(String name, String text) {
            ui.post(() -> {
                saveName = name;
                saveText = text;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("text/csv");
                i.putExtra(Intent.EXTRA_TITLE, name);
                try { startActivityForResult(i, REQ_SAVE); }
                catch (Exception e) { js("error", "บันทึกไฟล์ไม่ได้"); }
            });
        }

        @JavascriptInterface
        public void setFullscreen(boolean on) { ui.post(() -> applyFullscreen(on)); }

        @JavascriptInterface
        public void setOrientation(String mode) {
            ui.post(() -> setRequestedOrientation(
                    "landscape".equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    : "portrait".equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                    : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED));
        }

        @JavascriptInterface
        public void setBarColor(String hex) {
            ui.post(() -> {
                try {
                    int c = Color.parseColor(hex);
                    getWindow().setStatusBarColor(c);
                    getWindow().setNavigationBarColor(c);
                    web.setBackgroundColor(c);
                    // ธีมสว่างให้ไอคอนแถบสถานะเป็นสีเข้ม
                    boolean light = Color.luminance(c) > 0.5f;
                    View d = getWindow().getDecorView();
                    int f = d.getSystemUiVisibility();
                    int lf = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    d.setSystemUiVisibility(light ? f | lf : f & ~lf);
                } catch (Exception ignored) { }
            });
        }
    }

    private void applyFullscreen(boolean on) {
        View d = getWindow().getDecorView();
        int keep = d.getSystemUiVisibility() & (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        d.setSystemUiVisibility(keep | (on ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE : 0));
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__back ? window.__back() : false", r -> {
            if (!"true".equals(r)) defaultBack();
        });
    }

    private void defaultBack() { super.onBackPressed(); }

    private void js(String fn, String arg) {
        String a = arg == null ? "" : JSONObject.quote(arg);
        ui.post(() -> web.evaluateJavascript(
                "window.__ble && window.__ble." + fn + " && window.__ble." + fn + "(" + a + ")", null));
    }

    // ---------------- Permissions & adapter ----------------
    private String[] neededPerms() {
        if (Build.VERSION.SDK_INT >= 31)
            return new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT};
        return new String[]{Manifest.permission.ACCESS_FINE_LOCATION};
    }

    private boolean hasPerms() {
        for (String p : neededPerms())
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    private void startConnect() {
        if (adapter == null) { js("error", "เครื่องนี้ไม่มี Bluetooth"); return; }
        if (!hasPerms()) { requestPermissions(neededPerms(), REQ_PERM); return; }
        if (!adapter.isEnabled()) {
            startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), REQ_ENABLE_BT);
            return;
        }
        closeGatt();
        String addr = prefs.getString("addr", null);
        if (addr != null) {
            js("status", "กำลังเชื่อมต่อ " + prefs.getString("name", addr) + "...");
            connectDevice(adapter.getRemoteDevice(addr));
            fromSaved = true;
            final BluetoothGatt attempt = gatt;
            // ถ้า 10 วินาทียังไม่พร้อม ให้สแกนหาใหม่
            ui.postDelayed(() -> {
                if (!ready && gatt == attempt && gatt != null) {
                    closeGatt();
                    fallbackToScan();
                }
            }, 10000);
        } else {
            startScan();
        }
    }

    private void fallbackToScan() {
        fromSaved = false;
        js("status", "ต่อกับตัวเดิมไม่ได้ กำลังสแกนใหม่...");
        startScan();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_PERM) {
            if (hasPerms()) startConnect();
            else js("error", "ต้องอนุญาตสิทธิ์ Bluetooth (อุปกรณ์ใกล้เคียง) ก่อนใช้งาน");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SAVE) {
            String text = saveText, name = saveName;
            saveText = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null || text == null) return;
            try (OutputStream os = getContentResolver().openOutputStream(data.getData())) {
                os.write(text.getBytes(StandardCharsets.UTF_8));
                ui.post(() -> web.evaluateJavascript("window.__saved && window.__saved(" + JSONObject.quote(name) + ")", null));
            } catch (Exception e) {
                js("error", "บันทึกไฟล์ไม่สำเร็จ: " + e.getMessage());
            }
            return;
        }
        if (requestCode == REQ_ENABLE_BT) {
            if (adapter.isEnabled()) startConnect();
            else js("error", "กรุณาเปิด Bluetooth");
        }
    }

    // ---------------- Scan ----------------
    private void startScan() {
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) { js("error", "สแกน Bluetooth ไม่ได้ ลองปิด-เปิด Bluetooth"); return; }
        js("status", "กำลังค้นหาตัวเสียบ OBD (5 วินาที)...");
        final Map<String, ScanResult> found = new LinkedHashMap<>();
        final ScanCallback cb = new ScanCallback() {
            @Override public void onScanResult(int type, ScanResult r) {
                found.put(r.getDevice().getAddress(), r);
            }
            @Override public void onScanFailed(int code) {
                js("error", "สแกนไม่สำเร็จ (code " + code + ")" +
                        (Build.VERSION.SDK_INT < 31 ? " — ตรวจว่าเปิด Location แล้ว" : ""));
            }
        };
        scanner.startScan(cb);
        ui.postDelayed(() -> {
            try { scanner.stopScan(cb); } catch (Exception ignored) { }
            showPicker(new ArrayList<>(found.values()));
        }, SCAN_MS);
    }

    private static boolean looksObd(String n) {
        if (n == null) return false;
        String u = n.toUpperCase(Locale.ROOT);
        return u.contains("OBD") || u.contains("LINK") || u.contains("ELM") || u.contains("VGATE")
                || u.contains("ICAR") || u.contains("KONNWEI") || u.contains("CAR");
    }

    private void showPicker(List<ScanResult> list) {
        // ชื่อที่ดูเหมือน OBD ขึ้นก่อน, อุปกรณ์ไม่มีชื่อไว้ท้าย
        list.sort((a, b) -> {
            String na = a.getDevice().getName(), nb = b.getDevice().getName();
            int sa = looksObd(na) ? 0 : (na != null ? 1 : 2);
            int sb = looksObd(nb) ? 0 : (nb != null ? 1 : 2);
            if (sa != sb) return sa - sb;
            return b.getRssi() - a.getRssi();
        });
        if (list.isEmpty()) {
            js("error", "ไม่พบอุปกรณ์ — ติดเครื่องรถ และปิดแอพ OBD อื่นที่ต่ออยู่ก่อน");
            return;
        }
        String[] labels = new String[list.size()];
        for (int i = 0; i < list.size(); i++) {
            BluetoothDevice d = list.get(i).getDevice();
            String n = d.getName();
            labels[i] = (n != null ? n : "(ไม่มีชื่อ)") + "   " + d.getAddress() + "   " + list.get(i).getRssi() + " dBm";
        }
        new AlertDialog.Builder(this)
                .setTitle("เลือกตัวเสียบ OBD")
                .setItems(labels, (dlg, which) -> {
                    BluetoothDevice d = list.get(which).getDevice();
                    js("status", "กำลังเชื่อมต่อ " + (d.getName() != null ? d.getName() : d.getAddress()) + "...");
                    connectDevice(d);
                })
                .setNegativeButton("ยกเลิก", (dlg, w) -> js("error", "ยกเลิกการเชื่อมต่อ"))
                .setOnCancelListener(dlg -> js("error", "ยกเลิกการเชื่อมต่อ"))
                .show();
    }

    // ---------------- GATT ----------------
    private void connectDevice(BluetoothDevice d) {
        ready = false;
        fromSaved = false;
        rxChar = txChar = null;
        writeQueue.clear();
        writing = false;
        gatt = d.connectGatt(this, false, gattCb, BluetoothDevice.TRANSPORT_LE);
    }

    private void closeGatt() {
        ready = false;
        writeQueue.clear();
        writing = false;
        if (gatt != null) {
            try { gatt.disconnect(); gatt.close(); } catch (Exception ignored) { }
            gatt = null;
        }
    }

    private void pumpWrites() {
        if (writing || gatt == null || txChar == null || writeQueue.isEmpty()) return;
        byte[] chunk = writeQueue.poll();
        boolean noResp = (txChar.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE) == 0;
        txChar.setWriteType(noResp ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
        txChar.setValue(chunk);
        writing = gatt.writeCharacteristic(txChar);
        if (!writing) {
            // ลองใหม่อีกครั้งในอีกนิด
            writeQueue.addFirst(chunk);
            ui.postDelayed(this::pumpWrites, 30);
        }
    }

    private final BluetoothGattCallback gattCb = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            ui.post(() -> {
                if (g != gatt) { g.close(); return; }
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    js("status", "เชื่อมต่อแล้ว กำลังค้นหาช่องข้อมูล...");
                    g.discoverServices();
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    boolean wasReady = ready;
                    closeGatt();
                    if (wasReady) js("disconnected", null);
                    else if (fromSaved) fallbackToScan();
                    else js("error", "เชื่อมต่อไม่สำเร็จ (status " + status + ") ลองกดเชื่อมต่ออีกครั้ง");
                }
            });
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            ui.post(() -> {
                if (g != gatt) return;
                BluetoothGattCharacteristic rx = null, tx = null;
                // หา service ที่มีทั้ง notify และ write อยู่ด้วยกัน (ข้าม service มาตรฐาน 18xx ของระบบ)
                for (BluetoothGattService s : g.getServices()) {
                    String su = s.getUuid().toString();
                    if (su.startsWith("00001800") || su.startsWith("00001801") || su.startsWith("0000180a")) continue;
                    BluetoothGattCharacteristic r = null, t = null;
                    for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                        int p = c.getProperties();
                        if (r == null && (p & (BluetoothGattCharacteristic.PROPERTY_NOTIFY | BluetoothGattCharacteristic.PROPERTY_INDICATE)) != 0) r = c;
                        if (t == null && (p & (BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0) t = c;
                    }
                    if (r != null && t != null) { rx = r; tx = t; break; }
                }
                if (rx == null) {
                    closeGatt();
                    js("error", "อุปกรณ์นี้ไม่ใช่ตัวเสียบ OBD แบบ BLE (ไม่พบช่องรับส่งข้อมูล)");
                    return;
                }
                rxChar = rx;
                txChar = tx;
                g.setCharacteristicNotification(rx, true);
                BluetoothGattDescriptor desc = rx.getDescriptor(CCCD);
                if (desc != null) {
                    boolean notify = (rx.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0;
                    desc.setValue(notify ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                            : BluetoothGattDescriptor.ENABLE_INDICATION_VALUE);
                    if (!g.writeDescriptor(desc)) onReady(g);
                } else {
                    onReady(g);
                }
            });
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) {
            ui.post(() -> { if (g == gatt && !ready) onReady(g); });
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
            ui.post(() -> { writing = false; pumpWrites(); });
        }

        // Android 12 ลงมา
        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
            if (Build.VERSION.SDK_INT >= 33) return;
            emit(c.getValue());
        }

        // Android 13 ขึ้นไป
        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] value) {
            emit(value);
        }

        private void emit(byte[] v) {
            if (v != null && v.length > 0) js("data", new String(v, StandardCharsets.ISO_8859_1));
        }
    };

    private void onReady(BluetoothGatt g) {
        ready = true;
        // ขอช่วงเชื่อมต่อถี่ขึ้น ให้อ่านค่าได้เร็วขึ้น (สำคัญกับการจับเวลา)
        g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH);
        BluetoothDevice d = g.getDevice();
        String name = d.getName() != null ? d.getName() : d.getAddress();
        prefs.edit().putString("addr", d.getAddress()).putString("name", name).apply();
        js("log", "Service " + rxChar.getService().getUuid() + "  RX " + rxChar.getUuid() + "  TX " + txChar.getUuid());
        js("connected", name);
    }
}
