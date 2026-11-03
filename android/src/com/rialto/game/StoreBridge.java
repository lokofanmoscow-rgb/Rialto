package com.rialto.game;

import android.content.Context;
import android.webkit.JavascriptInterface;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/** Слоты сохранения во внутренней памяти приложения: window.AndroidStore */
public class StoreBridge {
    private final File dir;

    public StoreBridge(Context ctx) {
        dir = new File(ctx.getFilesDir(), "saves");
        if (!dir.exists()) dir.mkdirs();
    }

    private File file(String key) {
        String safe = key == null ? "x" : key.replaceAll("[^a-zA-Z0-9_-]", "_");
        return new File(dir, safe + ".json");
    }

    @JavascriptInterface
    public boolean save(String key, String text) {
        File f = file(key);
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (IOException e) {
            return false;
        }
        return tmp.renameTo(f) || (f.delete() && tmp.renameTo(f));
    }

    @JavascriptInterface
    public String load(String key) {
        File f = file(key);
        if (!f.exists()) return null;
        try (FileInputStream in = new FileInputStream(f); ByteArrayOutputStream bo = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return new String(bo.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
    }

    @JavascriptInterface
    public boolean remove(String key) { return file(key).delete(); }
}
