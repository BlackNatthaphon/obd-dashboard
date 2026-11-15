package digital.blacktech.homecam;

import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.security.keystore.UserNotAuthenticatedException;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

/**
 * Every screen: no screenshots / screen recording / recents thumbnail,
 * no touches through overlays, and redirect to the lock screen when locked.
 */
public abstract class BaseActivity extends AppCompatActivity {

    interface StoreOp {
        void run(CameraStore s) throws Exception;
    }

    private static final int REQ_CONFIRM = 7001;
    private Runnable pendingOk, pendingCancel;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= 31) getWindow().setHideOverlayWindows(true);
    }

    @Override
    public void setContentView(int layoutResID) {
        super.setContentView(layoutResID);
        getWindow().getDecorView().setFilterTouchesWhenObscured(true);
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (requiresUnlock() && App.get().isLocked()) {
            redirectToLock();
            return;
        }
        onSecureStart();
    }

    private void redirectToLock() {
        if (!requiresUnlock()) return;
        startActivity(new Intent(this, LockActivity.class));
        onLocked();
    }

    @Override
    protected void onStop() {
        onSecureStop();
        super.onStop();
    }

    protected boolean requiresUnlock() { return true; }

    /** Called when this screen comes back but the app has locked in the meantime. */
    protected void onLocked() {}

    /** Like onStart, but only called while unlocked. */
    protected void onSecureStart() {}

    /** Must be safe to call even if onSecureStart did not run. */
    protected void onSecureStop() {}

    // ------------------------------------------------------------------ auth

    static boolean deviceSecure(android.content.Context ctx) {
        KeyguardManager km = ctx.getSystemService(KeyguardManager.class);
        return km != null && km.isDeviceSecure();
    }

    @SuppressWarnings("deprecation")
    static int authenticators() {
        return Build.VERSION.SDK_INT >= 30
                ? BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
                : BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
    }

    /** Fingerprint / face / PIN prompt. Falls back to the system PIN screen if needed. */
    protected void authenticate(Runnable ok, Runnable cancel) {
        if (!deviceSecure(this)) {
            cancel.run();
            return;
        }
        BiometricPrompt prompt = new BiometricPrompt(this, ContextCompat.getMainExecutor(this),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) {
                        App.get().endAuth(true);
                        ok.run();
                    }

                    @Override
                    public void onAuthenticationError(int code, CharSequence msg) {
                        if (code == BiometricPrompt.ERROR_USER_CANCELED
                                || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                                || code == BiometricPrompt.ERROR_CANCELED) {
                            boolean locked = App.get().endAuth(false);
                            cancel.run();
                            if (locked) redirectToLock();
                        } else {
                            confirmCredential(ok, cancel);
                        }
                    }
                });
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("ยืนยันตัวตน")
                .setSubtitle("เพื่อเปิดดูกล้องในบ้าน")
                .setAllowedAuthenticators(authenticators())
                .setConfirmationRequired(false)
                .build();
        App.get().beginAuth();
        try {
            prompt.authenticate(info);
        } catch (RuntimeException e) {
            confirmCredential(ok, cancel);
        }
    }

    /** System PIN/pattern/password screen; always unlocks the Keystore key. */
    @SuppressWarnings("deprecation")
    protected void confirmCredential(Runnable ok, Runnable cancel) {
        KeyguardManager km = getSystemService(KeyguardManager.class);
        Intent i = km == null ? null
                : km.createConfirmDeviceCredentialIntent("ยืนยันตัวตน", "ใส่ PIN / รหัสผ่านของเครื่อง");
        if (i == null) {
            boolean locked = App.get().endAuth(false);
            cancel.run();
            if (locked) redirectToLock();
            return;
        }
        pendingOk = ok;
        pendingCancel = cancel;
        App.get().beginAuth();
        startActivityForResult(i, REQ_CONFIRM);
    }

    @Override
    protected void onActivityResult(int req, int res, @Nullable Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_CONFIRM) return;
        boolean success = res == RESULT_OK;
        boolean locked = App.get().endAuth(success);
        Runnable r = success ? pendingOk : pendingCancel;
        pendingOk = pendingCancel = null;
        if (r != null) r.run();
        if (locked) redirectToLock();
    }

    /**
     * Runs an operation on the encrypted store. If the 5-minute key window has
     * expired, asks the user to authenticate and retries.
     * {@code stage}: 0 = try directly, 1 = just authenticated, 2 = just used PIN.
     */
    protected void runStoreOp(StoreOp op, Runnable ok, Runnable fail, int stage) {
        try {
            op.run(App.get().store());
            ok.run();
        } catch (UserNotAuthenticatedException e) {
            if (stage == 0) {
                authenticate(() -> runStoreOp(op, ok, fail, 1), fail);
            } else if (stage == 1) {
                // e.g. a "weak" face unlock that the Keystore does not accept.
                confirmCredential(() -> runStoreOp(op, ok, fail, 2), fail);
            } else {
                toast("ยืนยันตัวตนไม่สำเร็จ");
                fail.run();
            }
        } catch (Exception e) {
            toast("บันทึก/อ่านข้อมูลไม่สำเร็จ: " + e.getClass().getSimpleName());
            fail.run();
        }
    }

    protected void runStoreOp(StoreOp op, Runnable ok) {
        runStoreOp(op, ok, () -> {}, 0);
    }

    protected void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }

    protected float dp(float v) {
        return v * getResources().getDisplayMetrics().density;
    }
}
