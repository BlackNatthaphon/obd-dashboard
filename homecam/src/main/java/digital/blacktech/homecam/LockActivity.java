package digital.blacktech.homecam;

import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;

/** Unlock screen: fingerprint / face / PIN, then decrypt the camera list. */
public class LockActivity extends BaseActivity {

    private TextView msg;
    private Button unlock, settings;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_lock);
        msg = findViewById(R.id.msg);
        unlock = findViewById(R.id.unlock);
        settings = findViewById(R.id.settings);
        unlock.setOnClickListener(v -> start());
        settings.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS)));
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { finishAffinity(); }
        });
    }

    @Override protected boolean requiresUnlock() { return false; }

    @Override
    protected void onStart() {
        super.onStart();
        // Prompt automatically when the app is opened, but not when we are coming
        // back from the system PIN screen (that result is still being delivered),
        // and never re-prompt after the user cancelled: they can tap the button.
        if (App.get().isLocked() && !App.get().authInProgress()) start();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!App.get().isLocked()) finish();
    }

    private void start() {
        if (!deviceSecure(this)) {
            msg.setText("เพื่อความปลอดภัย กรุณาตั้งการล็อกหน้าจอของมือถือก่อน "
                    + "(PIN, รหัสผ่าน หรือสแกนนิ้ว) แล้วกลับมาที่แอปนี้");
            settings.setVisibility(View.VISIBLE);
            unlock.setVisibility(View.GONE);
            return;
        }
        settings.setVisibility(View.GONE);
        unlock.setVisibility(View.VISIBLE);
        msg.setText("แตะ \"ปลดล็อก\" แล้วสแกนนิ้ว/ใบหน้า หรือใส่ PIN ของเครื่อง");
        authenticate(this::load, () -> {});
    }

    private void load() {
        runStoreOp(CameraStore::load, () -> {
            App.get().unlock();
            if (App.get().store().consumeResetFlag()) {
                new AlertDialog.Builder(this)
                        .setTitle("รีเซ็ตข้อมูลกล้องแล้ว")
                        .setMessage("การล็อกหน้าจอของมือถือถูกเปลี่ยนหรือข้อมูลถูกแก้ไข "
                                + "แอปจึงลบข้อมูลกล้องเดิมทิ้งเพื่อความปลอดภัย กรุณาเพิ่มกล้องใหม่")
                        .setPositiveButton("ตกลง", (d, w) -> finish())
                        .setCancelable(false)
                        .show();
            } else {
                finish();
            }
        }, () -> {}, 1);
    }
}
