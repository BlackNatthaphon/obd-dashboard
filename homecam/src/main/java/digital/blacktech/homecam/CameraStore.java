package digital.blacktech.homecam;

import android.content.Context;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
import android.util.AtomicFile;

import org.json.JSONArray;
import org.json.JSONException;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.Key;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Camera list encrypted at rest with AES-256-GCM.
 *
 * The key lives in the Android Keystore (TEE / StrongBox when present), can never be
 * exported, and can only be used for {@link #AUTH_WINDOW_S} seconds after the user
 * unlocks with fingerprint/face/PIN. Without that unlock the file is unreadable,
 * even with root access to the app's storage. Removing the phone's screen lock
 * destroys the key, and the data with it.
 *
 * Cipher operations throw {@link android.security.keystore.UserNotAuthenticatedException}
 * when the window has expired; callers re-authenticate and retry
 * (see {@link BaseActivity#runStoreOp}).
 */
public final class CameraStore {

    static final int AUTH_WINDOW_S = 300;
    private static final String ALIAS = "homecam.store.v1";
    private static final byte VERSION = 1;
    private static final byte[] AAD = "homecam/cameras/v1".getBytes(StandardCharsets.UTF_8);

    private final AtomicFile file;
    /** Decrypted cameras; null while the app is locked. */
    private List<Camera> cache;
    private boolean wasReset;

    CameraStore(Context ctx) {
        file = new AtomicFile(new File(ctx.getNoBackupFilesDir(), "cameras.bin"));
    }

    // ---------------------------------------------------------------- public API

    synchronized boolean isLoaded() {
        return cache != null;
    }

    /** True if the last {@link #load()} had to discard unreadable/invalidated data. */
    synchronized boolean consumeResetFlag() {
        boolean r = wasReset;
        wasReset = false;
        return r;
    }

    /** Decrypts the store into memory. Needs a fresh user authentication. */
    synchronized void load() throws GeneralSecurityException, IOException {
        if (!file.getBaseFile().exists()) {
            List<Camera> empty = new ArrayList<>();
            write(empty);      // creates the key and proves it works right after unlock
            cache = empty;
            return;
        }
        try {
            SecretKey key = key(false);
            if (key == null) throw new KeyPermanentlyInvalidatedException();
            byte[] plain = decrypt(key, file.readFully());
            JSONArray arr = new JSONArray(new String(plain, StandardCharsets.UTF_8));
            List<Camera> list = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) list.add(Camera.fromJson(arr.getJSONObject(i)));
            cache = list;
        } catch (KeyPermanentlyInvalidatedException | AEADBadTagException | JSONException
                 | IllegalArgumentException e) {
            // Screen lock removed/changed, key gone, or file tampered with.
            // Fail closed: wipe everything and start empty.
            wipeFiles();
            wasReset = true;
            List<Camera> empty = new ArrayList<>();
            write(empty);
            cache = empty;
        }
    }

    synchronized List<Camera> cameras() {
        if (cache == null) return Collections.emptyList();
        List<Camera> out = new ArrayList<>(cache.size());
        for (Camera c : cache) out.add(c.copy());
        return out;
    }

    synchronized Camera find(String id) {
        if (cache != null) for (Camera c : cache) if (c.id.equals(id)) return c.copy();
        return null;
    }

    synchronized void put(Camera cam) throws GeneralSecurityException, IOException {
        requireLoaded();
        List<Camera> next = new ArrayList<>(cache);
        boolean replaced = false;
        for (int i = 0; i < next.size(); i++) {
            if (next.get(i).id.equals(cam.id)) {
                next.set(i, cam.copy());
                replaced = true;
            }
        }
        if (!replaced) next.add(cam.copy());
        write(next);
        cache = next;
    }

    synchronized void remove(String id) throws GeneralSecurityException, IOException {
        requireLoaded();
        List<Camera> next = new ArrayList<>(cache);
        for (int i = next.size() - 1; i >= 0; i--) if (next.get(i).id.equals(id)) next.remove(i);
        write(next);
        cache = next;
    }

    /** Deletes the encrypted file and destroys the key. Irreversible. */
    synchronized void wipe() {
        wipeFiles();
        cache = null;
    }

    /** Called on lock: drop decrypted data (incl. passwords) from memory. */
    synchronized void clearCache() {
        if (cache != null) {
            for (Camera c : cache) c.pass = "";
        }
        cache = null;
    }

    // ---------------------------------------------------------------- internals

    private void requireLoaded() {
        if (cache == null) throw new IllegalStateException("store locked");
    }

    private void wipeFiles() {
        file.delete();
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            ks.deleteEntry(ALIAS);
        } catch (GeneralSecurityException | IOException ignored) {
        }
    }

    private void write(List<Camera> list) throws GeneralSecurityException, IOException {
        JSONArray arr = new JSONArray();
        try {
            for (Camera c : list) arr.put(c.toJson());
        } catch (JSONException e) {
            throw new IOException(e);
        }
        byte[] blob = encrypt(key(true), arr.toString().getBytes(StandardCharsets.UTF_8));
        FileOutputStream out = file.startWrite();
        try {
            out.write(blob);
            file.finishWrite(out);
        } catch (IOException e) {
            file.failWrite(out);
            throw e;
        }
    }

    private static byte[] encrypt(SecretKey key, byte[] plain) throws GeneralSecurityException {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key);   // Keystore picks a random IV
        c.updateAAD(AAD);
        byte[] iv = c.getIV();
        byte[] ct = c.doFinal(plain);
        return ByteBuffer.allocate(2 + iv.length + ct.length)
                .put(VERSION).put((byte) iv.length).put(iv).put(ct).array();
    }

    private static byte[] decrypt(SecretKey key, byte[] blob) throws GeneralSecurityException {
        ByteBuffer b = ByteBuffer.wrap(blob);
        if (blob.length < 2 + 12 + 16 || b.get() != VERSION) throw new AEADBadTagException("bad header");
        int ivLen = b.get() & 0xff;
        if (ivLen < 12 || ivLen > 16 || b.remaining() < ivLen + 16) throw new AEADBadTagException("bad iv");
        byte[] iv = new byte[ivLen];
        b.get(iv);
        byte[] ct = new byte[b.remaining()];
        b.get(ct);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
        c.updateAAD(AAD);
        return c.doFinal(ct);
    }

    private static SecretKey key(boolean create) throws GeneralSecurityException, IOException {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        Key k = ks.getKey(ALIAS, null);
        if (k instanceof SecretKey) return (SecretKey) k;
        if (!create) return null;
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                return generate(true);
            } catch (StrongBoxUnavailableException e) {
                // No secure element on this phone; fall back to the TEE.
            }
        }
        return generate(false);
    }

    @SuppressWarnings("deprecation")
    private static SecretKey generate(boolean strongBox) throws GeneralSecurityException {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true);
        if (Build.VERSION.SDK_INT >= 30) {
            b.setUserAuthenticationParameters(AUTH_WINDOW_S,
                    KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
        } else {
            b.setUserAuthenticationValidityDurationSeconds(AUTH_WINDOW_S);
        }
        if (strongBox && Build.VERSION.SDK_INT >= 28) b.setIsStrongBoxBacked(true);
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(b.build());
        return kg.generateKey();
    }
}
