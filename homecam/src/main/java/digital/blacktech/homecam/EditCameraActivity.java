package digital.blacktech.homecam;

import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.core.content.ContextCompat;
import androidx.media3.ui.PlayerView;

import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/** Add or edit a camera: brand presets, ONVIF discovery/auto-config, live test. */
public class EditCameraActivity extends BaseActivity {

    static final String EXTRA_ID = "id";

    private final Handler main = new Handler(Looper.getMainLooper());
    private EditText name, host, user, pass, port, mainPath, subPath;
    private Spinner brand;
    private TextView hint, previewStatus, testResult;
    private CheckBox tcp;
    private View previewBox;
    private Camera editing;            // null = adding
    /** Stable id for a new camera, so a double-tapped Save can't add it twice. */
    private final String draftId = UUID.randomUUID().toString();
    private String onvifXaddr = "";
    private boolean loaded, suppressPreset = true;
    private LiveStream test;
    private AlertDialog busy;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_edit);
        name = findViewById(R.id.name);
        brand = findViewById(R.id.brand);
        hint = findViewById(R.id.hint);
        host = findViewById(R.id.host);
        user = findViewById(R.id.user);
        pass = findViewById(R.id.pass);
        port = findViewById(R.id.port);
        mainPath = findViewById(R.id.mainPath);
        subPath = findViewById(R.id.subPath);
        tcp = findViewById(R.id.tcp);
        previewBox = findViewById(R.id.previewBox);
        previewStatus = findViewById(R.id.status);
        testResult = findViewById(R.id.testResult);

        ArrayAdapter<Brands.Brand> ad = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, Brands.ALL);
        ad.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        brand.setAdapter(ad);
        brand.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                Brands.Brand b = Brands.ALL[pos];
                hint.setText(b.hint);
                if (suppressPreset) {
                    suppressPreset = false;
                    return;
                }
                if (b.id.equals(Brands.CUSTOM)) return;
                port.setText(String.valueOf(b.port));
                mainPath.setText(b.main);
                subPath.setText(b.sub);
                if (user.getText().toString().trim().isEmpty()) user.setText(b.user);
            }

            @Override public void onNothingSelected(AdapterView<?> p) {}
        });

        findViewById(R.id.back).setOnClickListener(v -> finish());
        findViewById(R.id.btnScan).setOnClickListener(v -> scan());
        findViewById(R.id.btnOnvif).setOnClickListener(v -> fetchOnvif());
        findViewById(R.id.btnTest).setOnClickListener(v -> runTest());
        findViewById(R.id.btnSave).setOnClickListener(v -> save());
        findViewById(R.id.btnDelete).setOnClickListener(v -> confirmDelete());
    }

    @Override
    protected void onSecureStart() {
        if (loaded) return;
        loaded = true;
        String id = getIntent().getStringExtra(EXTRA_ID);
        if (id != null) editing = App.get().store().find(id);
        Camera c = editing != null ? editing : new Camera();
        ((TextView) findViewById(R.id.title)).setText(editing != null ? "แก้ไขกล้อง" : "เพิ่มกล้อง");
        findViewById(R.id.btnDelete).setVisibility(editing != null ? View.VISIBLE : View.GONE);
        if (editing == null) {
            c.name = "กล้อง " + (App.get().store().cameras().size() + 1);
        }
        name.setText(c.name);
        host.setText(c.host);
        user.setText(c.user);
        pass.setText(c.pass);
        port.setText(String.valueOf(c.port));
        mainPath.setText(c.mainPath);
        subPath.setText(c.subPath);
        tcp.setChecked(c.tcp);
        onvifXaddr = c.onvif;
        int bi = Brands.indexOf(c.brand);
        suppressPreset = true;
        brand.setSelection(bi, false);
        hint.setText(Brands.ALL[bi].hint);
        if (bi == 0) suppressPreset = false;   // no selection event when it doesn't change
    }

    @Override
    protected void onSecureStop() {
        stopTest();
    }

    @Override
    protected void onLocked() {
        // Never leave a half-typed password sitting behind the lock screen.
        finish();
    }

    @Override
    protected void onDestroy() {
        if (busy != null) busy.dismiss();
        super.onDestroy();
    }

    // ------------------------------------------------------------------ form

    /** Reads the form into a Camera, or shows the problem and returns null. */
    private Camera readForm() {
        Camera c = editing != null ? editing.copy() : new Camera();
        if (editing == null) c.id = draftId;
        String h = host.getText().toString().trim();
        if (h.toLowerCase(Locale.ROOT).startsWith("rtsp://")) {
            Camera parsed = new Camera();
            if (!parsed.applyRtspUrl(h)) {
                host.setError("ลิงก์ RTSP ไม่ถูกต้อง");
                return null;
            }
            host.setText(parsed.host);
            port.setText(String.valueOf(parsed.port));
            mainPath.setText(parsed.mainPath);
            if (!parsed.user.isEmpty()) {
                user.setText(parsed.user);
                pass.setText(parsed.pass);
            }
            h = parsed.host;
        }
        if (h.isEmpty()) {
            host.setError("ใส่ IP ของกล้อง เช่น 192.168.1.20");
            host.requestFocus();
            return null;
        }
        int p;
        try {
            p = Integer.parseInt(port.getText().toString().trim());
            if (p < 1 || p > 65535) throw new NumberFormatException();
        } catch (NumberFormatException e) {
            port.setError("พอร์ต 1–65535");
            port.requestFocus();
            return null;
        }
        String mp = mainPath.getText().toString().trim();
        if (mp.isEmpty()) {
            mainPath.setError("ใส่ path ของสตรีม หรือเลือกยี่ห้อ / ใช้ ONVIF");
            mainPath.requestFocus();
            return null;
        }
        c.name = name.getText().toString().trim();
        if (c.name.isEmpty()) c.name = h;
        c.brand = ((Brands.Brand) brand.getSelectedItem()).id;
        c.host = h;
        c.port = p;
        c.user = user.getText().toString().trim();
        c.pass = pass.getText().toString();
        c.mainPath = mp;
        c.subPath = subPath.getText().toString().trim();
        c.tcp = tcp.isChecked();
        c.onvif = onvifXaddr;
        return c;
    }

    private void save() {
        Camera c = readForm();
        if (c == null) return;
        runStoreOp(s -> s.put(c), () -> {
            toast("บันทึกแล้ว");
            finish();
        });
    }

    private void confirmDelete() {
        if (editing == null) return;
        new AlertDialog.Builder(this)
                .setTitle("ลบกล้องนี้?")
                .setNegativeButton("ยกเลิก", null)
                .setPositiveButton("ลบ", (d, w) -> runStoreOp(s -> s.remove(editing.id), this::finish))
                .show();
    }

    // ------------------------------------------------------------------ test

    private void runTest() {
        Camera c = readForm();
        if (c == null) return;
        stopTest();
        previewBox.setVisibility(View.VISIBLE);
        testResult.setVisibility(View.VISIBLE);
        testResult.setTextColor(ContextCompat.getColor(this, R.color.muted));
        testResult.setText("กำลังทดสอบ…");
        test = new LiveStream(this, (PlayerView) findViewById(R.id.video), previewStatus, c, false)
                .setAutoRetry(false)
                .setListener((ok, err) -> {
                    testResult.setTextColor(ContextCompat.getColor(this, ok ? R.color.ok : R.color.danger));
                    testResult.setText(ok ? "✓ เชื่อมต่อสำเร็จ กด \"บันทึก\" ได้เลย" : "✗ " + err);
                });
        test.start();
    }

    private void stopTest() {
        if (test != null) {
            test.stop();
            test = null;
        }
    }

    // ------------------------------------------------------------------ ONVIF

    private void scan() {
        showBusy("กำลังค้นหากล้องใน Wi-Fi…");
        App.io().execute(() -> {
            List<Onvif.Device> found = null;
            String err = null;
            try {
                found = Onvif.discover(this, 4000);
            } catch (IOException e) {
                err = e.getMessage();
            }
            final List<Onvif.Device> f = found;
            final String fe = err;
            main.post(() -> {
                if (isFinishing()) return;
                hideBusy();
                if (f == null || f.isEmpty()) {
                    new AlertDialog.Builder(this)
                            .setTitle("ไม่พบกล้อง")
                            .setMessage((fe != null ? fe + "\n\n" : "")
                                    + "ตรวจว่ามือถืออยู่ Wi-Fi เดียวกับกล้อง กล้องบางยี่ห้อต้องเปิด ONVIF "
                                    + "ในแอปของกล้องก่อน หรือเลือกยี่ห้อแล้วใส่ IP เอง "
                                    + "(ดู IP ได้ในแอปกล้องหรือหน้าเราเตอร์)")
                            .setPositiveButton("ตกลง", null)
                            .show();
                    return;
                }
                String[] items = new String[f.size()];
                for (int i = 0; i < items.length; i++) items[i] = f.get(i).name + "\n" + f.get(i).host;
                new AlertDialog.Builder(this)
                        .setTitle("พบ " + f.size() + " กล้อง")
                        .setItems(items, (d, which) -> {
                            Onvif.Device dev = f.get(which);
                            host.setText(dev.host);
                            onvifXaddr = dev.xaddr;
                            String n = name.getText().toString();
                            if (n.isEmpty() || n.startsWith("กล้อง ")) name.setText(dev.name);
                            toast("ใส่ชื่อผู้ใช้/รหัสผ่านกล้อง แล้วกด \"ดึงลิงก์อัตโนมัติ\"");
                            user.requestFocus();
                        })
                        .show();
            });
        });
    }

    private void fetchOnvif() {
        String h = host.getText().toString().trim();
        if (h.isEmpty()) {
            host.setError("ใส่ IP หรือกด \"ค้นหากล้องใน Wi-Fi\" ก่อน");
            return;
        }
        String u = user.getText().toString().trim(), pw = pass.getText().toString();
        String x = onvifXaddr;
        showBusy("กำลังถามลิงก์สตรีมจากกล้อง…");
        App.io().execute(() -> {
            Onvif.Streams s = null;
            String err = null;
            try {
                s = Onvif.fetchStreams(h, x, u, pw);
            } catch (IOException e) {
                err = e.getMessage();
            }
            final Onvif.Streams fs = s;
            final String fe = err;
            main.post(() -> {
                if (isFinishing()) return;
                hideBusy();
                if (fs == null) {
                    new AlertDialog.Builder(this)
                            .setTitle("ดึงลิงก์ไม่สำเร็จ")
                            .setMessage(fe + "\n\nลองเลือกยี่ห้อกล้องจากรายการแทน")
                            .setPositiveButton("ตกลง", null)
                            .show();
                    return;
                }
                Uri m = Uri.parse(fs.main);
                brand.setSelection(0);
                port.setText(String.valueOf(m.getPort() > 0 ? m.getPort() : 554));
                mainPath.setText(pathOf(m));
                subPath.setText(fs.sub != null ? pathOf(Uri.parse(fs.sub)) : "");
                toast("ได้ลิงก์แล้ว กด \"ทดสอบ\" เพื่อดูภาพ");
            });
        });
    }

    private static String pathOf(Uri u) {
        String p = u.getEncodedPath() == null ? "/" : u.getEncodedPath();
        return u.getEncodedQuery() != null ? p + "?" + u.getEncodedQuery() : p;
    }

    private void showBusy(String msg) {
        hideBusy();
        busy = new AlertDialog.Builder(this).setMessage(msg).setCancelable(false).show();
    }

    private void hideBusy() {
        if (busy != null) {
            busy.dismiss();
            busy = null;
        }
    }
}
