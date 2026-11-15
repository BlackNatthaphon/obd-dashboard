package digital.blacktech.homecam;

import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.media3.ui.PlayerView;

import java.util.ArrayList;
import java.util.List;

/** Grid of live cameras (low-res sub streams). Tap = fullscreen, long-press = edit. */
public class MainActivity extends BaseActivity {

    private LinearLayout grid;
    private View empty, scroll;
    private final List<LiveStream> live = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        grid = findViewById(R.id.grid);
        empty = findViewById(R.id.empty);
        scroll = findViewById(R.id.scroll);
        findViewById(R.id.btnAdd).setOnClickListener(v -> openEditor(null));
        findViewById(R.id.btnEmptyAdd).setOnClickListener(v -> openEditor(null));
        findViewById(R.id.btnLock).setOnClickListener(v -> lockNow());
        findViewById(R.id.btnMenu).setOnClickListener(this::showMenu);
    }

    @Override
    protected void onSecureStart() {
        buildGrid();
    }

    @Override
    protected void onSecureStop() {
        stopAll();
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (!App.get().isLocked() && !live.isEmpty()) buildGrid();
    }

    private void stopAll() {
        for (LiveStream s : live) s.stop();
        live.clear();
        grid.removeAllViews();
    }

    private void buildGrid() {
        stopAll();
        List<Camera> cams = App.get().store().cameras();
        empty.setVisibility(cams.isEmpty() ? View.VISIBLE : View.GONE);
        scroll.setVisibility(cams.isEmpty() ? View.GONE : View.VISIBLE);
        if (cams.isEmpty()) return;

        int screenW = getResources().getDisplayMetrics().widthPixels;
        int widthDp = getResources().getConfiguration().screenWidthDp;
        int cols = widthDp >= 1000 ? 3 : widthDp >= 600 ? 2 : 1;
        int pad = (int) dp(8), margin = (int) dp(6);
        int tileW = (screenW - 2 * pad) / cols - 2 * margin;
        int tileH = tileW * 9 / 16;

        LayoutInflater inf = getLayoutInflater();
        LinearLayout row = null;
        for (int i = 0; i < cams.size(); i++) {
            if (i % cols == 0) {
                row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                grid.addView(row);
            }
            Camera cam = cams.get(i);
            View tile = inf.inflate(R.layout.item_camera, row, false);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(tileW, tileH);
            lp.setMargins(margin, margin, margin, margin);
            row.addView(tile, lp);

            ((TextView) tile.findViewById(R.id.name)).setText(cam.name);
            View touch = tile.findViewById(R.id.touch);
            touch.setOnClickListener(v -> startActivity(
                    new Intent(this, PlayerActivity.class).putExtra(PlayerActivity.EXTRA_ID, cam.id)));
            touch.setOnLongClickListener(v -> {
                showCameraMenu(v, cam);
                return true;
            });

            LiveStream s = new LiveStream(this, (PlayerView) tile.findViewById(R.id.video),
                    tile.findViewById(R.id.status), cam, true);
            live.add(s);
            s.start();
        }
    }

    private void openEditor(String id) {
        Intent i = new Intent(this, EditCameraActivity.class);
        if (id != null) i.putExtra(EditCameraActivity.EXTRA_ID, id);
        startActivity(i);
    }

    private void showCameraMenu(View anchor, Camera cam) {
        PopupMenu m = new PopupMenu(this, anchor);
        m.getMenu().add(0, 1, 0, "แก้ไข");
        m.getMenu().add(0, 2, 1, "ลบกล้องนี้");
        m.setOnMenuItemClickListener(item -> {
            if (item.getItemId() == 1) openEditor(cam.id);
            else confirmDelete(cam);
            return true;
        });
        m.show();
    }

    private void confirmDelete(Camera cam) {
        new AlertDialog.Builder(this)
                .setTitle("ลบ \"" + cam.name + "\"?")
                .setMessage("ข้อมูลกล้องและรหัสผ่านที่บันทึกไว้จะถูกลบ")
                .setNegativeButton("ยกเลิก", null)
                .setPositiveButton("ลบ", (d, w) -> runStoreOp(s -> s.remove(cam.id), this::buildGrid))
                .show();
    }

    private void showMenu(View anchor) {
        PopupMenu m = new PopupMenu(this, anchor);
        m.getMenu().add(0, 1, 0, "เกี่ยวกับความปลอดภัย");
        m.getMenu().add(0, 2, 1, "ลบข้อมูลทั้งหมด");
        m.setOnMenuItemClickListener(item -> {
            if (item.getItemId() == 1) showSecurityInfo();
            else confirmWipe();
            return true;
        });
        m.show();
    }

    private void lockNow() {
        stopAll();
        App.get().lock();
        startActivity(new Intent(this, LockActivity.class));
    }

    private void confirmWipe() {
        new AlertDialog.Builder(this)
                .setTitle("ลบข้อมูลทั้งหมด?")
                .setMessage("กล้องทุกตัวและรหัสผ่านจะถูกลบ และกุญแจเข้ารหัสจะถูกทำลาย ย้อนกลับไม่ได้")
                .setNegativeButton("ยกเลิก", null)
                .setPositiveButton("ลบทั้งหมด", (d, w) -> authenticate(() -> {
                    stopAll();
                    App.get().store().wipe();
                    App.get().lock();
                    startActivity(new Intent(this, LockActivity.class));
                }, () -> {}))
                .show();
    }

    private void showSecurityInfo() {
        new AlertDialog.Builder(this)
                .setTitle("ความปลอดภัย")
                .setMessage(
                        "• ภาพจากกล้องวิ่งตรงจากกล้องมาที่มือถือภายในบ้าน ไม่ผ่านคลาวด์หรือเซิร์ฟเวอร์ใดๆ\n\n"
                        + "• แอปเชื่อมต่อได้เฉพาะที่อยู่ในเครือข่ายบ้าน (LAN) หรือผ่าน VPN เข้าบ้านเท่านั้น\n\n"
                        + "• รหัสผ่านกล้องถูกเข้ารหัส AES-256 ด้วยกุญแจในชิปความปลอดภัยของมือถือ "
                        + "ซึ่งใช้ได้เฉพาะหลังสแกนนิ้ว/ใบหน้า/PIN\n\n"
                        + "• แอปล็อกทันทีเมื่อออกจากแอปหรือปิดจอ\n\n"
                        + "• ห้ามแคปหน้าจอ/อัดหน้าจอ และไม่สำรองข้อมูลขึ้นคลาวด์\n\n"
                        + "แนะนำ: ตั้งรหัสผ่านกล้องให้ยาวและไม่ซ้ำกับที่อื่น อัปเดตเฟิร์มแวร์กล้อง "
                        + "และอย่าเปิด port forward ที่เราเตอร์ — ถ้าจะดูนอกบ้านให้ใช้ VPN (เช่น WireGuard/Tailscale)")
                .setPositiveButton("ตกลง", null)
                .show();
    }
}
