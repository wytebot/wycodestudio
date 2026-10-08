package __PACKAGE__;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Message;
import android.os.Environment;
import android.os.Vibrator;
import android.text.TextUtils;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.window.OnBackAnimationCallback;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.window.BackEvent;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * WyBuild standalone shell.
 *
 * The site runs inside this app's own WebView, so there is never a browser address bar or Chrome toolbar,
 * whether or not Digital Asset Links verify. Everything the web page cannot do by itself is done natively here:
 * fullscreen/immersive mode, link routing (internal / external / other), runtime permissions, file upload,
 * downloads, JS dialogs, fullscreen video, offline screen, back navigation and local notifications.
 *
 * Configuration is read from assets/wybuild-config.json, written at build time by twa-native.py.
 */
public class WyBuildActivity extends Activity {
    private static final int REQ_FILE = 7001;
    private static final int REQ_PERMS = 7002;
    private static final int REQ_NOTIF = 7003;
    private static final int REQ_GEO = 7004;
    private static final int REQ_STORAGE = 7005;
    private static final String CHANNEL = "wybuild_default";

    private static final class Rule {
        boolean scheme, wildcard;
        String s = "", h = "", p = "", m = "";
    }

    private final List<Rule> rules = new ArrayList<>();
    private final Set<String> own = new HashSet<>();
    private String startUrl = "";
    private String appName = "";
    private String versionName = "";
    private boolean fullscreen, stickyFullscreen, notifications;
    private int themeColor = Color.WHITE, backgroundColor = Color.WHITE, navColor = Color.WHITE;

    private FrameLayout root;
    private WebView web;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingWebPermission;
    private String[] pendingWebAndroidPerms;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;
    private String[] pendingNotification;
    private String pendingDownloadUrl;
    private final Handler handler = new Handler();
    private OnBackInvokedCallback backCallback;
    private OnBackAnimationCallback backAnimationCallback;
    private float backProgress;

    // ------------------------------------------------------------------ lifecycle
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        loadConfig();
        configureWindow();

        root = new FrameLayout(this);
        root.setBackgroundColor(fullscreen ? backgroundColor : themeColor);
        installInsets(root);

        web = new WebView(this);
        web.setBackgroundColor(backgroundColor);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        configureWebView();
        installBackHandling();
        applySystemBars();
        root.requestApplyInsets();

        if (state != null && web.restoreState(state) != null) {
            // restored the previous page and history
        } else {
            handleIntent(getIntent());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.resumeTimers();
        }
        applySystemBars();
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.onPause();
            CookieManager.getInstance().flush();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        uninstallBackHandling();
        if (web != null) {
            root.removeView(web);
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) { applySystemBars(); if (root != null) root.requestApplyInsets(); }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // AndroidX is normally preferred for predictive back. This native shell intentionally
        // stays dependency-light, so API 34+ uses the platform animation callback and older
        // Android versions use the legacy callback.
        if (Build.VERSION.SDK_INT < 33) handleBack();
    }

    // ------------------------------------------------------------------ configuration
    private void loadConfig() {
        try {
            InputStream in = getAssets().open("wybuild-config.json");
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            in.close();
            JSONObject c = new JSONObject(buf.toString("UTF-8"));
            startUrl = c.optString("startUrl", "");
            appName = c.optString("name", "");
            versionName = c.optString("versionName", "");
            fullscreen = c.optBoolean("fullscreen", false);
            stickyFullscreen = "fullscreen-sticky".equals(c.optString("display", ""));
            notifications = c.optBoolean("notifications", false);
            themeColor = color(c.optString("themeColor"), Color.WHITE);
            backgroundColor = color(c.optString("backgroundColor"), Color.WHITE);
            navColor = color(c.optString("navigationColor"), themeColor);
            JSONArray hosts = c.optJSONArray("ownHosts");
            if (hosts != null) for (int i = 0; i < hosts.length(); i++) own.add(norm(hosts.optString(i)));
            JSONArray rs = c.optJSONArray("rules");
            if (rs != null) {
                for (int i = 0; i < rs.length(); i++) {
                    JSONObject o = rs.optJSONObject(i);
                    if (o == null) continue;
                    Rule r = new Rule();
                    r.scheme = "s".equals(o.optString("k"));
                    r.s = o.optString("s", "").toLowerCase();
                    r.h = norm(o.optString("h", ""));
                    r.wildcard = o.optBoolean("w", false);
                    r.p = o.optString("p", "");
                    r.m = o.optString("m", "");
                    rules.add(r);
                }
            }
        } catch (Exception e) {
            Toast.makeText(this, "App configuration is missing", Toast.LENGTH_LONG).show();
        }
        if (appName.isEmpty()) appName = getApplicationInfo().loadLabel(getPackageManager()).toString();
    }

    private static int color(String hex, int fallback) {
        try {
            return Color.parseColor(hex);
        } catch (Exception e) {
            return fallback;
        }
    }

    private static boolean isLight(int c) {
        return (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) > 160;
    }

    private static String norm(String h) {
        if (h == null) return "";
        h = h.toLowerCase();
        return h.startsWith("www.") ? h.substring(4) : h;
    }

    // ------------------------------------------------------------------ window, fullscreen, insets
    private void configureWindow() {
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.setStatusBarColor(fullscreen ? backgroundColor : themeColor);
        w.setNavigationBarColor(fullscreen ? backgroundColor : navColor);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 30) w.setDecorFitsSystemWindows(false);
    }

    private void installInsets(View v) {
        v.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                int l = 0, t = 0, r = 0, b = 0;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                    if (!fullscreen && customView == null) { l = bars.left; t = bars.top; r = bars.right; b = bars.bottom; }
                    b = Math.max(b, ime.bottom);
                } else {
                    if (!fullscreen && customView == null) {
                        l = insets.getSystemWindowInsetLeft();
                        t = insets.getSystemWindowInsetTop();
                        r = insets.getSystemWindowInsetRight();
                        b = insets.getSystemWindowInsetBottom();
                    }
                }
                view.setPadding(l, t, r, b);
                return Build.VERSION.SDK_INT >= 30 ? insets : insets.consumeSystemWindowInsets();
            }
        });
    }

    private void installBackHandling() {
        if (Build.VERSION.SDK_INT >= 34) {
            backAnimationCallback = new OnBackAnimationCallback() {
                @Override public void onBackStarted(BackEvent event) { backProgress = 0f; }
                @Override public void onBackProgressed(BackEvent event) {
                    backProgress = Math.max(0f, Math.min(1f, event.getProgress()));
                    if (root != null && customView == null) {
                        float shift = root.getWidth() * 0.04f * backProgress;
                        root.setTranslationX(event.getSwipeEdge() == BackEvent.EDGE_RIGHT ? shift : -shift);
                    }
                }
                @Override public void onBackCancelled() {
                    backProgress = 0f;
                    if (root != null) root.animate().translationX(0f).setDuration(120).start();
                }
                @Override public void onBackInvoked() {
                    if (root != null) root.setTranslationX(0f);
                    handleBack();
                }
            };
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backAnimationCallback);
        } else if (Build.VERSION.SDK_INT >= 33) {
            backCallback = new OnBackInvokedCallback() {
                @Override public void onBackInvoked() { handleBack(); }
            };
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    private void uninstallBackHandling() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (backAnimationCallback != null) {
                getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backAnimationCallback);
                backAnimationCallback = null;
            }
            if (backCallback != null) {
                getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
                backCallback = null;
            }
        }
    }

    private void handleBack() {
        if (customView != null) {
            hideCustomView();
        } else if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            finish();
        }
    }

    /** Fullscreen hides both Android system bars; sticky mode uses the more persistent swipe behavior. */
    @SuppressWarnings("deprecation")
    private void applySystemBars() {
        Window w = getWindow();
        boolean hide = fullscreen || customView != null;
        boolean lightStatus = isLight(fullscreen ? backgroundColor : themeColor);
        boolean lightNav = isLight(fullscreen ? backgroundColor : navColor);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c == null) return;
            int bars = WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars();
            if (hide) {
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(bars);
            } else {
                c.show(bars);
            }
            c.setSystemBarsAppearance(lightStatus ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
            c.setSystemBarsAppearance(lightNav ? WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0, WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        } else {
            int f = View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
            if (hide) {
                f |= View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION;
                f |= stickyFullscreen ? View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY : View.SYSTEM_UI_FLAG_IMMERSIVE;
            } else {
                if (Build.VERSION.SDK_INT >= 23 && lightStatus) f |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                if (Build.VERSION.SDK_INT >= 26 && lightNav) f |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            w.getDecorView().setSystemUiVisibility(f);
        }
    }

    // ------------------------------------------------------------------ WebView
    @SuppressWarnings({"deprecation", "SetJavaScriptEnabled"})
    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " WyBuildApp/" + versionName);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "WyBuildNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener(new android.webkit.DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String disposition, String mime, long length) {
                download(url, ua, disposition, mime);
            }
        });
    }

    private void handleIntent(Intent intent) {
        String target = null;
        if (intent != null) {
            String extra = intent.getStringExtra("wybuild_url");
            Uri data = intent.getData();
            if (extra != null) target = extra;
            else if (data != null && Intent.ACTION_VIEW.equals(intent.getAction())) target = data.toString();
        }
        if (target != null) {
            Uri t = Uri.parse(target);
            if (isWeb(t) && "internal".equals(resolve(t))) {
                web.loadUrl(target);
                return;
            }
        }
        if (web.getUrl() == null) web.loadUrl(startUrl);
    }

    // ------------------------------------------------------------------ link routing
    private static boolean isWeb(Uri u) {
        String sc = u.getScheme();
        return "http".equalsIgnoreCase(sc) || "https".equalsIgnoreCase(sc);
    }

    /** internal | external | other, or null when no rule matches. Mirrors wybuild-links.js. */
    private String resolve(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
        boolean web = isWeb(u);
        String h = norm(u.getHost());
        String path = u.getPath() == null ? "" : u.getPath();
        for (Rule r : rules) {
            if (r.scheme) {
                if (!web && r.s.equals(scheme)) return r.m;
                continue;
            }
            if (!web) continue;
            boolean hostOk = h.equals(r.h) || (r.wildcard && h.endsWith("." + r.h));
            if (hostOk && (r.p.isEmpty() || path.startsWith(r.p))) return r.m;
        }
        if (web && own.contains(h)) return "internal";
        // Built-in default: GitHub sign-in / authorization pages must load in THIS WebView. If they open in
        // the phone's browser, the session cookie is set there and the app never becomes signed in.
        // Explicit rules above always win over this default.
        if (web && "github.com".equals(h)
                && (path.equals("/login") || path.startsWith("/login/") || path.startsWith("/sessions")
                    || path.startsWith("/session") || path.startsWith("/settings/connections")
                    || path.startsWith("/settings/installations") || path.startsWith("/apps/"))) return "internal";
        return null;
    }

    /** Returns true when the link was handled outside the WebView; false when the WebView should load it. */
    private boolean route(String url) {
        Uri u = Uri.parse(url);
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
        if (scheme.isEmpty()) return false;
        if (scheme.equals("about") || scheme.equals("javascript") || scheme.equals("blob") || scheme.equals("data")) return false;
        if (scheme.equals("file") || scheme.equals("content")) return true;
        if (scheme.equals("intent")) {
            openIntentUri(url);
            return true;
        }
        boolean web = isWeb(u);
        String mode = resolve(u);
        if (mode == null) mode = web ? "external" : "other";
        if (mode.equals("internal") && web) return false;
        if (mode.equals("external") && web) {
            openInBrowser(u);
            return true;
        }
        openWithAndroid(u);
        return true;
    }

    private void openInBrowser(Uri u) {
        try {
            Intent i = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER);
            i.setData(u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            openWithAndroid(u);
        }
    }

    private void openWithAndroid(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            // ignore
        }
    }

    private void openIntentUri(String url) {
        try {
            Intent i = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.setComponent(null);
            i.setSelector(null);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            try {
                Intent i = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                String fb = i.getStringExtra("browser_fallback_url");
                if (fb != null) {
                    Uri f = Uri.parse(fb);
                    if (!route(f.toString())) web.loadUrl(f.toString());
                } else {
                    Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
                }
            } catch (Exception ignored) {
                // ignore
            }
        } catch (Exception e) {
            // ignore
        }
    }

    private final class Client extends WebViewClient {
        private boolean shown;

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            return route(request.getUrl().toString());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            shown = true;
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showOffline(request.getUrl().toString());
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int code, String description, String failingUrl) {
            if (Build.VERSION.SDK_INT < 23 && failingUrl != null) showOffline(failingUrl);
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler h, android.net.http.SslError error) {
            h.cancel();
            Toast.makeText(WyBuildActivity.this, "This site's security certificate is not valid", Toast.LENGTH_LONG).show();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            recreate();
            return true;
        }
    }

    private void showOffline(String failedUrl) {
        String safe = TextUtils.htmlEncode(failedUrl);
        String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'/><style>"
                + "body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;"
                + "background:" + hex(backgroundColor) + ";color:" + (isLight(backgroundColor) ? "#222" : "#eee") + ";text-align:center;padding:24px;box-sizing:border-box}"
                + "button{margin-top:20px;padding:12px 28px;border:0;border-radius:24px;font-size:16px;background:" + hex(themeColor) + ";color:"
                + (isLight(themeColor) ? "#111" : "#fff") + "}</style></head><body><h2>You're offline</h2>"
                + "<p>Check your connection and try again.</p><button onclick='location.replace(" + JSONObject.quote(failedUrl) + ")'>Retry</button>"
                + "<small style='opacity:.5;margin-top:24px;word-break:break-all'>" + safe + "</small></body></html>";
        web.loadDataWithBaseURL(failedUrl, html, "text/html", "UTF-8", failedUrl);
    }

    private static String hex(int c) {
        return String.format("#%06X", 0xFFFFFF & c);
    }

    // ------------------------------------------------------------------ Chrome client (dialogs, uploads, permissions, popups, video)
    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            final WebView popup = new WebView(WyBuildActivity.this);
            popup.setWebViewClient(new WebViewClient() {
                private boolean done;

                private boolean take(String url) {
                    if (done) return true;
                    done = true;
                    if (!route(url)) web.loadUrl(url);
                    handler.post(new Runnable() {
                        @Override
                        public void run() {
                            popup.stopLoading();
                            popup.destroy();
                        }
                    });
                    return true;
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                    return take(r.getUrl().toString());
                }

                @Override
                public void onPageStarted(WebView v, String url, Bitmap favicon) {
                    if (url != null && !"about:blank".equals(url)) take(url);
                }
            });
            WebView.WebViewTransport t = (WebView.WebViewTransport) resultMsg.obj;
            t.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            try {
                startActivityForResult(params.createIntent(), REQ_FILE);
            } catch (Exception e) {
                fileCallback = null;
                return false;
            }
            return true;
        }

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    handleWebPermission(request);
                }
            });
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (!declared(Manifest.permission.ACCESS_FINE_LOCATION) && !declared(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                callback.invoke(origin, false, false);
                return;
            }
            if (granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                callback.invoke(origin, true, false);
                return;
            }
            pendingGeoCallback = callback;
            pendingGeoOrigin = origin;
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_GEO);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customCallback = callback;
            web.setVisibility(View.GONE);
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            applySystemBars();
        }

        @Override
        public void onHideCustomView() {
            hideCustomView();
        }

        @Override
        public Bitmap getDefaultVideoPoster() {
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }

        @Override
        public boolean onJsAlert(WebView v, String url, String message, final JsResult result) {
            new AlertDialog.Builder(WyBuildActivity.this).setMessage(message).setCancelable(false)
                    .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface d, int w) { result.confirm(); }
                    }).show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView v, String url, String message, final JsResult result) {
            new AlertDialog.Builder(WyBuildActivity.this).setMessage(message).setCancelable(false)
                    .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface d, int w) { result.confirm(); }
                    })
                    .setNegativeButton(android.R.string.cancel, new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface d, int w) { result.cancel(); }
                    }).show();
            return true;
        }

        @Override
        public boolean onJsPrompt(WebView v, String url, String message, String def, final JsPromptResult result) {
            final EditText input = new EditText(WyBuildActivity.this);
            input.setText(def);
            new AlertDialog.Builder(WyBuildActivity.this).setMessage(message).setView(input).setCancelable(false)
                    .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface d, int w) { result.confirm(input.getText().toString()); }
                    })
                    .setNegativeButton(android.R.string.cancel, new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface d, int w) { result.cancel(); }
                    }).show();
            return true;
        }
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        if (customCallback != null) customCallback.onCustomViewHidden();
        customCallback = null;
        web.setVisibility(View.VISIBLE);
        applySystemBars();
        if (root != null) root.requestApplyInsets();
    }

    // ------------------------------------------------------------------ permissions
    private boolean granted(String p) {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean declared(String p) {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_PERMISSIONS);
            if (pi.requestedPermissions != null) for (String r : pi.requestedPermissions) if (p.equals(r)) return true;
        } catch (Exception ignored) {
            // ignore
        }
        return false;
    }

    private void handleWebPermission(PermissionRequest request) {
        Uri origin = request.getOrigin();
        if (origin == null || !"internal".equals(resolve(origin))) {
            request.deny();
            return;
        }
        List<String> grantRes = new ArrayList<>();
        List<String> need = new ArrayList<>();
        for (String res : request.getResources()) {
            String perm = null;
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) perm = Manifest.permission.CAMERA;
            else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) perm = Manifest.permission.RECORD_AUDIO;
            else if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(res)) grantRes.add(res);
            if (perm == null) continue;
            if (!declared(perm)) continue; // not enabled for this app in WyBuild: stays denied
            grantRes.add(res);
            if (!granted(perm)) need.add(perm);
        }
        if (grantRes.isEmpty()) {
            request.deny();
            return;
        }
        if (need.isEmpty()) {
            request.grant(grantRes.toArray(new String[0]));
            return;
        }
        if (pendingWebPermission != null) pendingWebPermission.deny();
        pendingWebPermission = request;
        pendingWebAndroidPerms = grantRes.toArray(new String[0]);
        requestPermissions(need.toArray(new String[0]), REQ_PERMS);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        boolean ok = results.length > 0;
        for (int r : results) if (r != PackageManager.PERMISSION_GRANTED) ok = false;
        if (code == REQ_PERMS && pendingWebPermission != null) {
            if (ok) pendingWebPermission.grant(pendingWebAndroidPerms); else pendingWebPermission.deny();
            pendingWebPermission = null;
        } else if (code == REQ_GEO && pendingGeoCallback != null) {
            boolean any = false;
            for (int r : results) if (r == PackageManager.PERMISSION_GRANTED) any = true;
            pendingGeoCallback.invoke(pendingGeoOrigin, any, false);
            pendingGeoCallback = null;
        } else if (code == REQ_NOTIF && pendingNotification != null) {
            String[] n = pendingNotification;
            pendingNotification = null;
            if (ok) postNotification(n[0], n[1], n[2]);
        } else if (code == REQ_STORAGE && pendingDownloadUrl != null) {
            String u = pendingDownloadUrl;
            pendingDownloadUrl = null;
            if (ok) download(u, web.getSettings().getUserAgentString(), null, null);
            else openInBrowser(Uri.parse(u));
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(code, result, data);
    }

    // ------------------------------------------------------------------ downloads
    @SuppressWarnings("deprecation")
    private void download(String url, String ua, String disposition, String mime) {
        Uri u = Uri.parse(url);
        if (!isWeb(u)) {
            Toast.makeText(this, "This download type is not supported in the app", Toast.LENGTH_LONG).show();
            return;
        }
        if (Build.VERSION.SDK_INT < 29 && !granted(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
            if (declared(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
                pendingDownloadUrl = url;
                requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            } else {
                openInBrowser(u);
            }
            return;
        }
        try {
            DownloadManager.Request r = new DownloadManager.Request(u);
            if (mime != null && !mime.isEmpty()) r.setMimeType(mime);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) r.addRequestHeader("Cookie", cookies);
            if (ua != null) r.addRequestHeader("User-Agent", ua);
            String name = URLUtil.guessFileName(url, disposition, mime);
            r.setTitle(name);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "Downloading " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            openInBrowser(u);
        }
    }

    // ------------------------------------------------------------------ notifications
    private void postNotification(String title, String body, String url) {
        if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
            pendingNotification = new String[]{title, body, url};
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
            return;
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(CHANNEL, appName, NotificationManager.IMPORTANCE_DEFAULT));
        Intent i = new Intent(this, WyBuildActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        String safeUrl = url;
        Uri tu = url == null ? null : Uri.parse(url);
        if (tu == null || !isWeb(tu) || !"internal".equals(resolve(tu))) safeUrl = startUrl;
        i.putExtra("wybuild_url", safeUrl);
        int id = (int) (System.nanoTime() & 0x7fffffff);
        PendingIntent pi = PendingIntent.getActivity(this, id, i, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        int icon = getResources().getIdentifier("ic_notification_icon", "drawable", getPackageName());
        if (icon == 0) icon = getApplicationInfo().icon;
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(icon).setContentTitle(title).setContentText(body).setContentIntent(pi).setAutoCancel(true);
        nm.notify(id, b.build());
    }

    // ------------------------------------------------------------------ JavaScript bridge: window.WyBuildNative
    private final class Bridge {
        @JavascriptInterface
        public boolean isApp() {
            return true;
        }

        @JavascriptInterface
        public String version() {
            return versionName;
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            runOnUiThread(new Runnable() {
                public void run() { openInBrowser(Uri.parse(url)); }
            });
        }

        @JavascriptInterface
        public void share(final String title, final String text, final String url) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_SUBJECT, title);
                    i.putExtra(Intent.EXTRA_TEXT, (text == null ? "" : text) + (url == null || url.isEmpty() ? "" : "\n" + url));
                    startActivity(Intent.createChooser(i, title));
                }
            });
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void vibrate(long ms) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && declared(Manifest.permission.VIBRATE)) v.vibrate(Math.max(1, Math.min(ms, 2000)));
        }

        @JavascriptInterface
        public void notify(final String title, final String body, final String url) {
            if (!notifications) return;
            runOnUiThread(new Runnable() {
                public void run() { postNotification(title, body, url); }
            });
        }
    }
}
