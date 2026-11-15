package digital.blacktech.homecam;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Holds the lock state. The app locks (and forgets decrypted data) as soon as
 * none of its screens is visible: home button, app switch, or screen off.
 */
public class App extends Application implements Application.ActivityLifecycleCallbacks {

    private static App instance;
    private static final ExecutorService IO = Executors.newCachedThreadPool();

    private CameraStore store;
    private int started;
    private boolean locked = true;
    /**
     * True while a fingerprint/PIN prompt is open. The system PIN screen puts our
     * screens in the background; we must not lock (and drop the data being saved)
     * behind it. If the user leaves during a prompt and it is cancelled, we lock.
     */
    private boolean externalAuth, awayDuringAuth;

    static App get() { return instance; }

    static ExecutorService io() { return IO; }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        store = new CameraStore(this);
        registerActivityLifecycleCallbacks(this);
    }

    CameraStore store() { return store; }

    boolean isLocked() { return locked || !store.isLoaded(); }

    void unlock() { locked = false; }

    void lock() {
        locked = true;
        store.clearCache();
    }

    boolean authInProgress() { return externalAuth; }

    void beginAuth() {
        externalAuth = true;
        awayDuringAuth = false;
    }

    /** @return true if the app had to lock (prompt cancelled after the user left the app). */
    boolean endAuth(boolean success) {
        boolean away = awayDuringAuth || started <= 0;
        externalAuth = false;
        awayDuringAuth = false;
        if (!success && away) {
            lock();
            return true;
        }
        return false;
    }

    @Override public void onActivityStarted(Activity a) {
        started++;
    }

    @Override public void onActivityStopped(Activity a) {
        started--;
        if (started <= 0 && !a.isChangingConfigurations()) {
            if (externalAuth) awayDuringAuth = true;
            else lock();
        }
    }

    @Override public void onActivityCreated(Activity a, Bundle b) {}
    @Override public void onActivityResumed(Activity a) {}
    @Override public void onActivityPaused(Activity a) {}
    @Override public void onActivitySaveInstanceState(Activity a, Bundle b) {}
    @Override public void onActivityDestroyed(Activity a) {}
}
