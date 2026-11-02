package gg.lolbuilds.tft;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.Locale;

/**
 * Shows the LoL Builds TFT site (published by GitHub Pages, so it updates without a
 * new APK) and lets the page start the floating overlay through the "Android" bridge.
 */
public class MainActivity extends Activity {
    static final String SITE = BuildConfig.SITE_URL;
    private static final int BG = Color.parseColor("#0d0f14");

    private WebView web;
    private boolean wantOverlay;

    static boolean es() {
        return "es".equals(Locale.getDefault().getLanguage());
    }

    @SuppressLint("SetJavaScriptEnabled")
    static void configure(WebView v) {
        WebSettings s = v.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " LoLBuildsApp/" + BuildConfig.VERSION_NAME);
        v.setBackgroundColor(BG);
    }

    @SuppressLint("JavascriptInterface")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        w.setStatusBarColor(BG);
        w.setNavigationBarColor(BG);

        web = new WebView(this);
        configure(web);
        setContentView(web);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String u = r.getUrl().toString();
                if (u.startsWith(SITE) && !u.endsWith(".apk")) return false;
                openExternal(u); // APK downloads and other sites open in the browser
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) v.loadDataWithBaseURL(null, offlineHtml(), "text/html", "utf-8", null);
            }
        });
        if (state != null) web.restoreState(state);
        else web.loadUrl(SITE);

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // back from the "display over other apps" settings screen
        if (wantOverlay && Settings.canDrawOverlays(this)) {
            wantOverlay = false;
            startOverlay();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_LONG).show();
    }

    void toggleOverlay() {
        if (OverlayService.running) {
            stopService(new Intent(this, OverlayService.class));
            toast(es() ? "Overlay cerrado" : "Overlay closed");
            return;
        }
        if (!Settings.canDrawOverlays(this)) {
            wantOverlay = true;
            toast(es() ? "Activa «Mostrar sobre otras apps» para LoL Builds TFT y vuelve"
                    : "Turn on “Display over other apps” for LoL Builds TFT and come back");
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
            } catch (ActivityNotFoundException e) {
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION));
            }
            return;
        }
        startOverlay();
    }

    private void startOverlay() {
        Intent i = new Intent(this, OverlayService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i);
        else startService(i);
        toast(es() ? "Overlay activo: abre TFT y toca la burbuja" : "Overlay on: open TFT and tap the bubble");
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private String offlineHtml() {
        String t = es() ? "Sin conexión" : "No connection";
        String m = es() ? "Revisa tu internet y vuelve a intentarlo." : "Check your internet and try again.";
        String b = es() ? "Reintentar" : "Retry";
        return "<html><body style='background:#0d0f14;color:#e9ebf1;font-family:sans-serif;display:flex;flex-direction:column;"
                + "align-items:center;justify-content:center;height:90vh;text-align:center'><h2>" + t + "</h2><p style='color:#9097a8'>" + m
                + "</p><button onclick='Android.reload()' style='background:#ff2e63;color:#fff;border:0;border-radius:8px;padding:12px 20px;"
                + "font-size:16px'>" + b + "</button></body></html>";
    }

    /** Methods the page can call as window.Android.* */
    class Bridge {
        @JavascriptInterface
        public void toggleOverlay() {
            runOnUiThread(MainActivity.this::toggleOverlay);
        }

        @JavascriptInterface
        public boolean overlayRunning() {
            return OverlayService.running;
        }

        @JavascriptInterface
        public int versionCode() {
            return BuildConfig.VERSION_CODE;
        }

        @JavascriptInterface
        public String versionName() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> openExternal(url));
        }

        @JavascriptInterface
        public void reload() {
            runOnUiThread(() -> web.loadUrl(SITE));
        }
    }
}
