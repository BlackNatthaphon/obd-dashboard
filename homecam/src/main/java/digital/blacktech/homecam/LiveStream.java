package digital.blacktech.homecam;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.TextView;

import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.rtsp.RtspMediaSource;
import androidx.media3.ui.PlayerView;

import java.io.IOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;

/** One live RTSP view with low-latency buffering and automatic reconnect. */
@OptIn(markerClass = UnstableApi.class)
final class LiveStream implements Player.Listener {

    interface Listener {
        void onLiveState(boolean playing, String error);
    }

    private final Context ctx;
    private final PlayerView view;
    private final TextView status;
    private final Camera cam;
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean sub, muted = true, autoRetry = true, running;
    private Listener listener;
    private ExoPlayer player;
    private int attempt, generation;

    LiveStream(Context ctx, PlayerView view, TextView status, Camera cam, boolean sub) {
        this.ctx = ctx.getApplicationContext();
        this.view = view;
        this.status = status;
        this.cam = cam;
        this.sub = sub;
    }

    LiveStream setListener(Listener l) { listener = l; return this; }

    LiveStream setAutoRetry(boolean r) { autoRetry = r; return this; }

    void start() {
        running = true;
        attempt = 0;
        connect();
    }

    void stop() {
        running = false;
        generation++;
        main.removeCallbacksAndMessages(null);
        release();
    }

    boolean isSub() { return sub; }

    void setSub(boolean s) {
        if (s == sub) return;
        sub = s;
        if (running) {
            attempt = 0;
            connect();
        }
    }

    boolean isMuted() { return muted; }

    void setMuted(boolean m) {
        muted = m;
        if (player != null) player.setVolume(m ? 0f : 1f);
    }

    private void connect() {
        final int gen = ++generation;
        main.removeCallbacksAndMessages(null);
        showStatus(attempt == 0 ? "กำลังเชื่อมต่อ…" : "กำลังเชื่อมต่อใหม่…");
        App.io().execute(() -> {
            String ip = null, err = null;
            try {
                ip = NetGuard.resolveLocal(cam.host);
            } catch (IOException e) {
                err = e.getMessage();
            }
            final String fip = ip, ferr = err;
            main.post(() -> {
                if (!running || gen != generation) return;
                if (fip == null) fail(ferr, false);
                else play(cam.rtspUri(fip, sub));
            });
        });
    }

    private void play(String uri) {
        release();
        player = new ExoPlayer.Builder(ctx)
                .setLoadControl(new DefaultLoadControl.Builder()
                        .setBufferDurationsMs(500, 3000, 250, 500)
                        .build())
                .build();
        player.addListener(this);
        player.setVolume(muted ? 0f : 1f);
        player.setMediaSource(new RtspMediaSource.Factory()
                .setForceUseRtpTcp(cam.tcp)
                .setTimeoutMs(8000)
                .createMediaSource(MediaItem.fromUri(uri)));
        view.setPlayer(player);
        player.setPlayWhenReady(true);
        player.prepare();
    }

    private void release() {
        if (player != null) {
            player.removeListener(this);
            view.setPlayer(null);
            player.release();
            player = null;
        }
    }

    @Override
    public void onPlaybackStateChanged(int state) {
        if (state == Player.STATE_READY) {
            attempt = 0;
            status.setVisibility(View.GONE);
            if (listener != null) listener.onLiveState(true, null);
        } else if (state == Player.STATE_ENDED) {
            fail("สตรีมหยุด", true);
        }
    }

    @Override
    public void onPlayerError(PlaybackException e) {
        fail(describe(e), true);
    }

    private void fail(String msg, boolean retryable) {
        release();
        if (listener != null) listener.onLiveState(false, msg);
        if (running && autoRetry && retryable) {
            long delay = Math.min(30_000L, 2_000L << Math.min(attempt, 4));
            attempt++;
            showStatus(msg + "\nลองใหม่ใน " + delay / 1000 + " วินาที");
            final int gen = generation;
            main.postDelayed(() -> {
                if (running && gen == generation) connect();
            }, delay);
        } else {
            showStatus(msg);
        }
    }

    private void showStatus(String s) {
        status.setText(s);
        status.setVisibility(View.VISIBLE);
    }

    static String describe(PlaybackException e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            String m = String.valueOf(t.getMessage());
            if (m.contains("401") || m.contains("Unauthorized")) return "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
            if (m.contains("404") || m.contains("Not Found")) return "ไม่พบสตรีม (ตรวจ path ของกล้อง)";
            if (t instanceof ConnectException || t instanceof NoRouteToHostException) {
                return "ติดต่อกล้องไม่ได้ — ตรวจ IP/พอร์ต และมือถือต้องอยู่ Wi-Fi บ้าน";
            }
            if (t instanceof SocketTimeoutException) return "กล้องไม่ตอบสนอง (หมดเวลา)";
        }
        if (e.errorCode == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED
                || e.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED) {
            return "มือถือถอดรหัสวิดีโอนี้ไม่ได้ — ลองตั้งกล้องเป็น H.264 หรือใช้สตรีมย่อย";
        }
        return "เชื่อมต่อไม่ได้ (" + e.getErrorCodeName() + ")";
    }
}
