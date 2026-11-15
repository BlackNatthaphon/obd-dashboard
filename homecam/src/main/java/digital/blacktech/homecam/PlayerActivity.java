package digital.blacktech.homecam;

import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.ui.PlayerView;

/** Fullscreen live view: main (HD) stream, optional SD and sound. */
public class PlayerActivity extends BaseActivity {

    static final String EXTRA_ID = "id";

    private LiveStream stream;
    private View bar;
    private TextView quality, mute;
    private boolean wantSub, wantUnmuted;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_player);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        ic.hide(WindowInsetsCompat.Type.systemBars());
        ic.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);

        bar = findViewById(R.id.bar);
        quality = findViewById(R.id.quality);
        mute = findViewById(R.id.mute);
        findViewById(R.id.back).setOnClickListener(v -> finish());
        findViewById(R.id.touch).setOnClickListener(v ->
                bar.setVisibility(bar.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE));
        quality.setOnClickListener(v -> {
            wantSub = !wantSub;
            if (stream != null) stream.setSub(wantSub);
            refreshButtons();
        });
        mute.setOnClickListener(v -> {
            wantUnmuted = !wantUnmuted;
            if (stream != null) stream.setMuted(!wantUnmuted);
            refreshButtons();
        });
    }

    @Override
    protected void onSecureStart() {
        Camera cam = App.get().store().find(getIntent().getStringExtra(EXTRA_ID));
        if (cam == null) {
            finish();
            return;
        }
        ((TextView) findViewById(R.id.name)).setText(cam.name);
        quality.setVisibility(cam.hasSubStream() ? View.VISIBLE : View.GONE);
        stream = new LiveStream(this, (PlayerView) findViewById(R.id.video), findViewById(R.id.status),
                cam, wantSub && cam.hasSubStream());
        stream.setMuted(!wantUnmuted);
        stream.start();
        refreshButtons();
    }

    @Override
    protected void onSecureStop() {
        if (stream != null) {
            stream.stop();
            stream = null;
        }
    }

    private void refreshButtons() {
        quality.setText(wantSub ? "SD" : "HD");
        mute.setText(wantUnmuted ? "🔊" : "🔇");
    }
}
