package com.rialto.game;

import android.app.Activity;
import android.content.Context;
import android.net.wifi.WifiManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONObject;

/** JS-мост к сетевому ядру: window.AndroidNet */
public class NetBridge implements LanNet.Listener {
    private final Activity activity;
    private final WebView web;
    private final LanNet net;
    private WifiManager.MulticastLock lock;

    public NetBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        this.net = new LanNet(this);
    }

    @Override
    public void onEvent(String type, String a, String b) {
        final String js = "window.__rialtoNative && window.__rialtoNative(" + JSONObject.quote(type) + "," + JSONObject.quote(a == null ? "" : a) + "," + JSONObject.quote(b == null ? "" : b) + ")";
        activity.runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    private synchronized void multicast(boolean on) {
        try {
            if (on) {
                if (lock == null) {
                    WifiManager wm = (WifiManager) activity.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    if (wm == null) return;
                    lock = wm.createMulticastLock("rialto");
                    lock.setReferenceCounted(false);
                }
                if (!lock.isHeld()) lock.acquire();
            } else if (lock != null && lock.isHeld()) {
                lock.release();
            }
        } catch (Exception ignored) { }
    }

    @JavascriptInterface public boolean hostStart(int port, String info) { multicast(true); return net.hostStart(port, info); }
    @JavascriptInterface public void hostUpdate(String info) { net.hostUpdate(info); }
    @JavascriptInterface public void hostStop() { net.hostStop(); multicast(false); }
    @JavascriptInterface public void hostSend(String id, String text) { net.hostSend(id, text); }
    @JavascriptInterface public void hostKick(String id) { net.hostKick(id); }
    @JavascriptInterface public void discoverStart() { multicast(true); net.discoverStart(); }
    @JavascriptInterface public void discoverStop() { net.discoverStop(); }
    @JavascriptInterface public void connect(String host, int port) { net.connect(host, port); }
    @JavascriptInterface public void clientSend(String text) { net.clientSend(text); }
    @JavascriptInterface public void clientClose() { net.clientClose(); }
    @JavascriptInterface public String localIps() { return LanNet.localIps(); }

    public void shutdown() { net.shutdown(); multicast(false); }
}
