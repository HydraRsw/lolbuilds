package gg.lolbuilds.tft;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Floating bubble over other apps (TFT). Tapping it opens a panel with the
 * comps and recipes pages; the bubble can be dragged anywhere.
 */
public class OverlayService extends Service {
    static volatile boolean running;
    static final String ACTION_STOP = "gg.lolbuilds.tft.STOP";
    private static final int GOLD = Color.parseColor("#e8b23a");
    private static final int BG = Color.parseColor("#0d0f14");

    private WindowManager wm;
    private SharedPreferences prefs;
    private ImageView bubble;
    private WindowManager.LayoutParams bp;
    private LinearLayout panel;
    private WindowManager.LayoutParams pp;
    private WebView web;
    private boolean panelShown;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startInForeground();
        if (bubble == null) createViews();
        running = true;
        return START_NOT_STICKY;
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private static int overlayType() {
        return Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private void startInForeground() {
        boolean es = MainActivity.es();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Notification.Builder nb;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel("overlay", es ? "Overlay de TFT" : "TFT overlay",
                    NotificationManager.IMPORTANCE_LOW));
            nb = new Notification.Builder(this, "overlay");
        } else {
            nb = new Notification.Builder(this);
        }
        int fl = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, OverlayService.class).setAction(ACTION_STOP), fl);
        PendingIntent open = PendingIntent.getActivity(this, 2, new Intent(this, MainActivity.class), fl);
        Notification n = nb.setSmallIcon(android.R.drawable.ic_menu_view)
                .setContentTitle(es ? "Overlay de TFT activo" : "TFT overlay on")
                .setContentText(es ? "Toca la burbuja para ver compos y recetas" : "Tap the bubble for comps and recipes")
                .setContentIntent(open)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder((Icon) null, es ? "Cerrar overlay" : "Close overlay", stop).build())
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(7, n);
    }

    private TextView barButton(String label, View.OnClickListener click) {
        TextView b = new TextView(this);
        b.setText(label);
        b.setTextColor(Color.WHITE);
        b.setTextSize(18);
        b.setGravity(Gravity.CENTER);
        b.setOnClickListener(click);
        return b;
    }

    @SuppressLint("ClickableViewAccessibility")
    private void createViews() {
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        prefs = getSharedPreferences("overlay", MODE_PRIVATE);

        // Panel: title bar (minimize / close) + the comps & recipes page
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable pbg = new GradientDrawable();
        pbg.setColor(BG);
        pbg.setCornerRadius(dp(12));
        pbg.setStroke(dp(1), GOLD);
        panel.setBackground(pbg);
        panel.setClipToOutline(true);
        panel.setPadding(dp(1), dp(1), dp(1), dp(1));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(12), 0, dp(2), 0);
        TextView title = new TextView(this);
        title.setText("LoL Builds · TFT");
        title.setTextColor(GOLD);
        title.setTextSize(14);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER_VERTICAL);
        bar.addView(title, new LinearLayout.LayoutParams(0, dp(40), 1f));
        bar.addView(barButton("–", v -> showPanel(false)), new LinearLayout.LayoutParams(dp(46), dp(40)));
        bar.addView(barButton("✕", v -> stopSelf()), new LinearLayout.LayoutParams(dp(46), dp(40)));
        panel.addView(bar);

        web = new WebView(this);
        MainActivity.configure(web);
        web.setWebViewClient(new WebViewClient());
        web.loadUrl(MainActivity.SITE + "panel.html");
        panel.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        pp = new WindowManager.LayoutParams(dp(300), dp(300), overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        pp.gravity = Gravity.TOP | Gravity.START;
        panel.setVisibility(View.GONE);
        wm.addView(panel, pp);

        // Bubble
        bubble = new ImageView(this);
        bubble.setImageResource(R.mipmap.ic_launcher);
        GradientDrawable bbg = new GradientDrawable();
        bbg.setShape(GradientDrawable.OVAL);
        bbg.setColor(BG);
        bbg.setStroke(dp(2), GOLD);
        bubble.setBackground(bbg);
        bubble.setPadding(dp(7), dp(7), dp(7), dp(7));
        bubble.setAlpha(0.92f);
        bp = new WindowManager.LayoutParams(dp(54), dp(54), overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        bp.gravity = Gravity.TOP | Gravity.START;
        bp.x = prefs.getInt("bx", dp(8));
        bp.y = prefs.getInt("by", dp(90));
        clampBubble();
        bubble.setOnTouchListener(new DragTouch());
        wm.addView(bubble, bp);
    }

    private void clampBubble() {
        DisplayMetrics m = getResources().getDisplayMetrics();
        bp.x = Math.max(0, Math.min(bp.x, m.widthPixels - dp(54)));
        bp.y = Math.max(0, Math.min(bp.y, m.heightPixels - dp(54)));
    }

    /** Landscape (TFT): a tall column beside the bubble. Portrait: most of the screen width. */
    private void sizePanel() {
        DisplayMetrics m = getResources().getDisplayMetrics();
        int w = m.widthPixels, h = m.heightPixels;
        if (w > h) {
            pp.width = Math.min(dp(420), (int) (w * 0.45f));
            pp.height = h - dp(16);
            boolean bubbleLeft = bp.x + dp(27) < w / 2;
            pp.x = bubbleLeft ? Math.min(bp.x + dp(60), w - pp.width) : Math.max(0, bp.x - pp.width - dp(6));
            pp.y = dp(8);
        } else {
            pp.width = w - dp(16);
            pp.height = (int) (h * 0.62f);
            pp.x = dp(8);
            pp.y = Math.min(bp.y + dp(60), h - pp.height - dp(8));
        }
    }

    private void showPanel(boolean show) {
        panelShown = show;
        if (show) {
            sizePanel();
            wm.updateViewLayout(panel, pp);
        }
        panel.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        if (bubble == null) return;
        clampBubble();
        wm.updateViewLayout(bubble, bp);
        if (panelShown) showPanel(true);
    }

    private class DragTouch implements View.OnTouchListener {
        private float downX, downY;
        private int startX, startY;
        private boolean moved;
        private final int slop = ViewConfiguration.get(OverlayService.this).getScaledTouchSlop();

        @Override
        public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = e.getRawX();
                    downY = e.getRawY();
                    startX = bp.x;
                    startY = bp.y;
                    moved = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
                    if (!moved && Math.hypot(dx, dy) < slop) return true;
                    moved = true;
                    bp.x = startX + Math.round(dx);
                    bp.y = startY + Math.round(dy);
                    clampBubble();
                    wm.updateViewLayout(bubble, bp);
                    if (panelShown) showPanel(true);
                    return true;
                case MotionEvent.ACTION_UP:
                    if (!moved) showPanel(!panelShown);
                    else prefs.edit().putInt("bx", bp.x).putInt("by", bp.y).apply();
                    return true;
                default:
                    return false;
            }
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        try {
            if (bubble != null) wm.removeView(bubble);
            if (panel != null) wm.removeView(panel);
        } catch (Exception ignored) {
        }
        if (web != null) web.destroy();
        bubble = null;
        panel = null;
        super.onDestroy();
    }
}
