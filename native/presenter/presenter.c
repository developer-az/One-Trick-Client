// onetrick-presenter.exe — native overlay presenter for One Trick.
//
// Owns ONE Win32 layered window and presents HUD frames handed to it over a
// named pipe by the Electron app (which renders the HUD offscreen). This is
// the native-overlay remake: Chromium never owns an on-screen window, so
// nothing about the DWM/MPO presentation path depends on the compositor.
//
// Protocol (little-endian, client -> presenter):
//   u32 type, u32 payloadLen, payload...
//   1 HELLO      { u32 version=1, u32 width, u32 height } (physical pixels)
//   2 FRAME      { u32 x, y, w, h, u8[] bgra } (top-down BGRA, dirty rect)
//   3 SHOW       {}
//   4 HIDE       {}
//   5 CLICKTHROUGH { u8 0|1 }   (1 = mouse passes through)
//   6 BOUNDS     { i32 x, y, w, h }
//   7 CAPTURE    { u8 0|1 }     (1 = exclude from capture)
//   8 PING       {}  -> replies PONG
// Presenter -> client:
//   101 READY    {}  (after HELLO)
//   102 PONG     {}
//   103 ERROR    { utf8 message }
//
// Lifecycle: the window is created hidden; SHOW makes it visible. The
// process exits when the pipe breaks (Electron respawns it). All lifecycle
// events are logged to %APPDATA%\One Trick\logs\presenter.log — that log
// is the acceptance evidence for the native overlay, same role overlay.log
// plays for the Electron window.

#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdarg.h>

#define PIPE_NAME "\\\\.\\pipe\\onetrick-presenter"
#define WM_APP_FRAME (WM_APP + 1)

#define MSG_HELLO 1
#define MSG_FRAME 2
#define MSG_SHOW 3
#define MSG_HIDE 4
#define MSG_CLICKTHROUGH 5
#define MSG_BOUNDS 6
#define MSG_CAPTURE 7
#define MSG_PING 8
#define MSG_READY 101
#define MSG_PONG 102
#define MSG_ERROR 103

#define PROTOCOL_VERSION 1

static HWND g_hwnd = NULL;
static HDC g_memDc = NULL;
static HBITMAP g_dib = NULL;
static HBITMAP g_stockBitmap = NULL;
static void *g_bits = NULL;
static int g_w = 0, g_h = 0;
static int g_clickThrough = 1;
static int g_captureExcluded = 0;
static int g_shown = 0;
static HANDLE g_pipe = INVALID_HANDLE_VALUE;
static CRITICAL_SECTION g_dibLock;
static FILE *g_log = NULL;
static long g_frameCount = 0;
static long g_lastLoggedFrame = 0;
static char g_pipeName[512] = PIPE_NAME;
static char g_logPath[MAX_PATH] = "";
static DWORD g_connectTimeoutMs = 30000;
static BYTE *g_payload = NULL;
static DWORD g_payloadCap = 0;
static DWORD g_lastZLog = 0, g_suppressedZ = 0;

static char *nextArg(char **cursor) {
    char *p = *cursor;
    while (*p == ' ' || *p == '\t') p++;
    if (!*p) { *cursor = p; return NULL; }
    char *start;
    if (*p == '"') {
        start = ++p;
        while (*p && *p != '"') p++;
    } else {
        start = p;
        while (*p && *p != ' ' && *p != '\t') p++;
    }
    if (*p) *p++ = 0;
    *cursor = p;
    return start;
}

static int parseArgs(char *line) {
    char *cursor = line, *flag, *value;
    while ((flag = nextArg(&cursor)) != NULL) {
        value = nextArg(&cursor);
        if (!value) return 0;
        if (!strcmp(flag, "--pipe")) {
            if (strlen(value) >= sizeof(g_pipeName)) return 0;
            strcpy(g_pipeName, value);
        } else if (!strcmp(flag, "--log")) {
            if (strlen(value) >= sizeof(g_logPath)) return 0;
            strcpy(g_logPath, value);
        } else if (!strcmp(flag, "--connect-timeout-ms")) {
            char *end = NULL;
            unsigned long n = strtoul(value, &end, 10);
            if (!*value || *end || n == 0 || n > 600000) return 0;
            g_connectTimeoutMs = (DWORD)n;
        } else return 0;
    }
    return 1;
}

static void logLine(const char *fmt, ...) {
    if (!g_log) return;
    SYSTEMTIME st;
    GetLocalTime(&st);
    fprintf(g_log, "%04d-%02d-%02d %02d:%02d:%02d.%03d ",
        st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond, st.wMilliseconds);
    va_list ap;
    va_start(ap, fmt);
    vfprintf(g_log, fmt, ap);
    va_end(ap);
    fputc('\n', g_log);
    fflush(g_log);
}

static void openLog(void) {
    if (g_logPath[0]) {
        g_log = fopen(g_logPath, "a");
        if (g_log) logLine("presenter-start pid=%lu", GetCurrentProcessId());
        return;
    }
    char appdata[MAX_PATH];
    if (!GetEnvironmentVariableA("APPDATA", appdata, MAX_PATH)) return;
    char dir[MAX_PATH];
    snprintf(dir, MAX_PATH, "%s\\One Trick\\logs", appdata);
    CreateDirectoryA(dir, NULL);
    char path[MAX_PATH];
    snprintf(path, MAX_PATH, "%s\\presenter.log", dir);
    g_log = fopen(path, "a");
    if (g_log) logLine("presenter-start pid=%lu", GetCurrentProcessId());
}

static int readExact(HANDLE h, void *buf, DWORD len) {
    BYTE *p = (BYTE *)buf;
    while (len > 0) {
        DWORD got = 0;
        if (!ReadFile(h, p, len, &got, NULL) || got == 0) return 0;
        p += got;
        len -= got;
    }
    return 1;
}

static int writeExact(HANDLE h, const void *buf, DWORD len) {
    const BYTE *p = (const BYTE *)buf;
    while (len > 0) {
        DWORD sent = 0;
        if (!WriteFile(h, p, len, &sent, NULL) || sent == 0) return 0;
        p += sent;
        len -= sent;
    }
    return 1;
}

static void sendReply(DWORD type, const void *payload, DWORD len) {
    DWORD hdr[2] = { type, len };
    writeExact(g_pipe, hdr, sizeof(hdr));
    if (len > 0) writeExact(g_pipe, payload, len);
}

static void sendError(const char *msg) {
    sendReply(MSG_ERROR, msg, (DWORD)strlen(msg));
}

static int createDib(int w, int h) {
    if (w < 1 || h < 1 || w > 16384 || h > 16384) return 0;
    BITMAPINFO bmi;
    memset(&bmi, 0, sizeof(bmi));
    bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth = w;
    bmi.bmiHeader.biHeight = -h; // top-down
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;
    HDC screen = GetDC(NULL);
    void *bits = NULL;
    HBITMAP dib = CreateDIBSection(screen, &bmi, DIB_RGB_COLORS, &bits, NULL, 0);
    ReleaseDC(NULL, screen);
    if (!dib || !bits) { if (dib) DeleteObject(dib); return 0; }
    if (!g_memDc) g_memDc = CreateCompatibleDC(NULL);
    if (!g_memDc) { DeleteObject(dib); return 0; }
    EnterCriticalSection(&g_dibLock);
    HBITMAP old = (HBITMAP)SelectObject(g_memDc, dib);
    if (!old || old == HGDI_ERROR) {
        LeaveCriticalSection(&g_dibLock);
        DeleteObject(dib);
        return 0;
    }
    if (!g_stockBitmap) g_stockBitmap = old;
    HBITMAP previousDib = g_dib;
    g_dib = dib;
    g_bits = bits;
    memset(bits, 0, (size_t)w * h * 4);
    g_w = w;
    g_h = h;
    if (previousDib) DeleteObject(previousDib);
    LeaveCriticalSection(&g_dibLock);
    return 1;
}

static void present(void) {
    if (!g_hwnd || !g_memDc || !g_dib) return;
    POINT ptDst = { 0, 0 };
    RECT rc;
    GetWindowRect(g_hwnd, &rc);
    ptDst.x = rc.left;
    ptDst.y = rc.top;
    SIZE size = { g_w, g_h };
    POINT ptSrc = { 0, 0 };
    BLENDFUNCTION blend;
    blend.BlendOp = AC_SRC_OVER;
    blend.BlendFlags = 0;
    blend.SourceConstantAlpha = 255;
    blend.AlphaFormat = AC_SRC_ALPHA;
    EnterCriticalSection(&g_dibLock);
    UpdateLayeredWindow(g_hwnd, NULL, &ptDst, &size, g_memDc, &ptSrc, 0, &blend, ULW_ALPHA);
    LeaveCriticalSection(&g_dibLock);
}

static void applyFrame(DWORD x, DWORD y, DWORD w, DWORD h, const BYTE *bgra) {
    if (!g_bits || !w || !h ||
        (uint64_t)x + w > (uint64_t)g_w ||
        (uint64_t)y + h > (uint64_t)g_h) return;
    EnterCriticalSection(&g_dibLock);
    BYTE *dst = (BYTE *)g_bits;
    for (DWORD row = 0; row < h; row++) {
        memcpy(dst + ((size_t)(y + row) * g_w + x) * 4,
               bgra + (size_t)row * w * 4,
               (size_t)w * 4);
    }
    LeaveCriticalSection(&g_dibLock);
    g_frameCount++;
    if (g_frameCount - g_lastLoggedFrame >= 600) {
        g_lastLoggedFrame = g_frameCount;
        logLine("frames=%ld", g_frameCount);
    }
    if (g_shown) present();
}

static void applyClickThrough(int on) {
    g_clickThrough = on ? 1 : 0;
    LONG_PTR ex = GetWindowLongPtrA(g_hwnd, GWL_EXSTYLE);
    if (on) ex |= WS_EX_TRANSPARENT;
    else ex &= ~WS_EX_TRANSPARENT;
    SetWindowLongPtrA(g_hwnd, GWL_EXSTYLE, ex);
    SetWindowPos(g_hwnd, NULL, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE);
    logLine("clickthrough=%d", g_clickThrough);
}

static void applyCapture(int on) {
    g_captureExcluded = on ? 1 : 0;
    typedef BOOL(WINAPI * SetAffinityFn)(HWND, DWORD);
    static SetAffinityFn fn = NULL;
    if (!fn) fn = (SetAffinityFn)GetProcAddress(GetModuleHandleA("user32.dll"), "SetWindowDisplayAffinity");
    if (fn) {
        // WDA_EXCLUDEFROMCAPTURE = 0x11; WDA_NONE = 0x00.
        if (!fn(g_hwnd, on ? 0x11 : 0x00)) {
            logLine("capture-affinity-failed on=%d err=%lu", on, GetLastError());
            return;
        }
    }
    logLine("capture-excluded=%d", g_captureExcluded);
}

static void applyShow(int show) {
    g_shown = show ? 1 : 0;
    ShowWindow(g_hwnd, show ? SW_SHOWNOACTIVATE : SW_HIDE);
    if (show) {
        SetWindowPos(g_hwnd, HWND_TOPMOST, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        present();
    }
    logLine(show ? "show" : "hide");
}

static void applyBounds(int x, int y, int w, int h) {
    if (w <= 0 || h <= 0 || w > 16384 || h > 16384) return;
    if (w != g_w || h != g_h) {
        if (!createDib(w, h)) {
            logLine("dib-resize-failed %dx%d", w, h);
            return;
        }
        logLine("resized %dx%d", w, h);
    }
    SetWindowPos(g_hwnd, NULL, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
    if (g_shown) present();
}

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    case WM_DISPLAYCHANGE:
        logLine("display-change"); // Electron re-sends BOUNDS.
        return 0;
    case WM_NCHITTEST:
        if (g_clickThrough) return HTTRANSPARENT;
        return DefWindowProcA(hwnd, msg, wParam, lParam);
    case WM_MOUSEACTIVATE:
        return MA_NOACTIVATE;
    case WM_TIMER:
        if (wParam == 1 && g_shown) {
            LONG_PTR style = GetWindowLongPtrA(hwnd, GWL_EXSTYLE);
            // Walk everything above us: hidden topmost helper windows (IME etc.)
            // can sit between us and a visible topmost window.
            int coveredByVisibleTopmost = 0;
            HWND above = GetWindow(hwnd, GW_HWNDPREV);
            for (int hops = 0; above && hops < 256; hops++, above = GetWindow(above, GW_HWNDPREV)) {
                if (IsWindowVisible(above) &&
                    (GetWindowLongPtrA(above, GWL_EXSTYLE) & WS_EX_TOPMOST)) {
                    coveredByVisibleTopmost = 1;
                    break;
                }
            }
            if (!(style & WS_EX_TOPMOST) || coveredByVisibleTopmost) {
                // Already topmost: HWND_TOPMOST is a no-op within the topmost
                // band; HWND_TOP lifts us above the other topmost window.
                SetWindowPos(hwnd, (style & WS_EX_TOPMOST) ? HWND_TOP : HWND_TOPMOST, 0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                DWORD now = GetTickCount();
                if (!g_lastZLog || now - g_lastZLog >= 10000) {
                    logLine("z-reasserted n=%lu", g_suppressedZ + 1);
                    g_lastZLog = now;
                    g_suppressedZ = 0;
                } else g_suppressedZ++;
            }
        }
        return 0;
    default:
        return DefWindowProcA(hwnd, msg, wParam, lParam);
    }
}

// Reader thread: blocking pipe reads, applies each message. The UI thread
// only pumps messages so the window stays alive to the system.
static DWORD WINAPI PipeThread(LPVOID param) {
    (void)param;
    for (;;) {
        DWORD hdr[2];
        if (!readExact(g_pipe, hdr, sizeof(hdr))) break;
        DWORD type = hdr[0], len = hdr[1];
        if (len > 64u * 1024u * 1024u) {
            logLine("oversize-message type=%lu len=%lu", type, len);
            break;
        }
        if (len > 0) {
            if (len > g_payloadCap) {
                BYTE *grown = (BYTE *)realloc(g_payload, len);
                if (!grown) break;
                g_payload = grown;
                g_payloadCap = len;
            }
            if (!readExact(g_pipe, g_payload, len)) break;
        }
        BYTE *payload = g_payload;
        switch (type) {
        case MSG_HELLO: {
            if (len < 12) { sendError("short HELLO"); break; }
            DWORD version = *(DWORD *)(payload + 0);
            DWORD w = *(DWORD *)(payload + 4);
            DWORD h = *(DWORD *)(payload + 8);
            if (version != PROTOCOL_VERSION) {
                sendError("protocol version mismatch");
                break;
            }
            if (w <= 0 || h <= 0 || w > 16384 || h > 16384) {
                sendError("bad HELLO size");
                break;
            }
            if (!createDib((int)w, (int)h)) {
                sendError("dib create failed");
                break;
            }
            applyBounds(0, 0, (int)w, (int)h);
            logLine("hello %lux%lu", w, h);
            sendReply(MSG_READY, NULL, 0);
            break;
        }
        case MSG_FRAME: {
            if (len < 16) break;
            DWORD x = *(DWORD *)(payload + 0);
            DWORD y = *(DWORD *)(payload + 4);
            DWORD w = *(DWORD *)(payload + 8);
            DWORD h = *(DWORD *)(payload + 12);
            if (!g_bits || !w || !h ||
                (uint64_t)w * h * 4 != (uint64_t)len - 16 ||
                (uint64_t)x + w > (uint64_t)g_w ||
                (uint64_t)y + h > (uint64_t)g_h) {
                logLine("frame-size-mismatch rect=%lux%lu len=%lu", w, h, len);
                break;
            }
            applyFrame(x, y, w, h, payload + 16);
            break;
        }
        case MSG_SHOW:
            applyShow(1);
            break;
        case MSG_HIDE:
            applyShow(0);
            break;
        case MSG_CLICKTHROUGH:
            if (len >= 1) applyClickThrough(payload[0] ? 1 : 0);
            break;
        case MSG_BOUNDS: {
            if (len < 16) break;
            int x = *(int *)(payload + 0);
            int y = *(int *)(payload + 4);
            int w = *(int *)(payload + 8);
            int h = *(int *)(payload + 12);
            applyBounds(x, y, w, h);
            break;
        }
        case MSG_CAPTURE:
            if (len >= 1) applyCapture(payload[0] ? 1 : 0);
            break;
        case MSG_PING:
            sendReply(MSG_PONG, NULL, 0);
            break;
        default:
            logLine("unknown-message type=%lu", type);
            break;
        }
    }
    free(g_payload);
    g_payload = NULL;
    g_payloadCap = 0;
    logLine("pipe-closed frames=%ld", g_frameCount);
    // Pipe broke: Electron is gone or respawning us. Exit; do not linger
    // as a stale topmost window over the game.
    PostMessageA(g_hwnd, WM_CLOSE, 0, 0);
    return 0;
}

static DWORD WINAPI ConnectThread(LPVOID param) {
    HANDLE pipe = (HANDLE)param;
    if (ConnectNamedPipe(pipe, NULL) || GetLastError() == ERROR_PIPE_CONNECTED)
        return 0;
    return GetLastError();
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    (void)hPrevInstance;
    (void)nCmdShow;
    if (!parseArgs(lpCmdLine)) return 1;
    InitializeCriticalSection(&g_dibLock);
    openLog();

    // Per-monitor DPI aware so the DIB is in physical pixels, matching the
    // physical-pixel frames Electron sends.
    typedef BOOL(WINAPI * SetDpiFn)(HANDLE);
    SetDpiFn setDpi = (SetDpiFn)GetProcAddress(
        GetModuleHandleA("user32.dll"), "SetProcessDpiAwarenessContext");
    if (setDpi) setDpi((HANDLE)-4); // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2

    WNDCLASSA wc;
    memset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = "OneTrickPresenter";
    wc.hCursor = LoadCursorA(NULL, IDC_ARROW);
    if (!RegisterClassA(&wc)) {
        logLine("register-class-failed err=%lu", GetLastError());
        return 1;
    }

    g_hwnd = CreateWindowExA(
        WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        "OneTrickPresenter", "One Trick \u00b7 NATIVE OVERLAY",
        WS_POPUP, 0, 0, 1920, 1080, NULL, NULL, hInstance, NULL);
    if (!g_hwnd) {
        logLine("create-window-failed err=%lu", GetLastError());
        return 1;
    }
    applyClickThrough(1);
    SetTimer(g_hwnd, 1, 1000, NULL);
    logLine("created");

    g_pipe = CreateNamedPipeA(
        g_pipeName, PIPE_ACCESS_DUPLEX,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
        1, 1 << 20, 1 << 20, 0, NULL);
    if (g_pipe == INVALID_HANDLE_VALUE) {
        logLine("create-pipe-failed err=%lu", GetLastError());
        return 1;
    }
    logLine("waiting-for-client");
    HANDLE connector = CreateThread(NULL, 0, ConnectThread, g_pipe, 0, NULL);
    if (!connector) {
        logLine("connect-thread-failed err=%lu", GetLastError());
        return 1;
    }
    DWORD wait = WaitForSingleObject(connector, g_connectTimeoutMs);
    if (wait == WAIT_TIMEOUT) {
        logLine("no-client-timeout");
        CancelSynchronousIo(connector);
        DisconnectNamedPipe(g_pipe);
        WaitForSingleObject(connector, 1000);
        CloseHandle(connector);
        KillTimer(g_hwnd, 1);
        DestroyWindow(g_hwnd);
        CloseHandle(g_pipe);
        logLine("destroy frames=%ld", g_frameCount);
        if (g_log) fclose(g_log);
        DeleteCriticalSection(&g_dibLock);
        return 0;
    }
    DWORD connectError = 0;
    GetExitCodeThread(connector, &connectError);
    CloseHandle(connector);
    if (wait != WAIT_OBJECT_0 || connectError) {
        logLine("connect-pipe-failed err=%lu", connectError);
        return 1;
    }
    logLine("client-connected");

    HANDLE thread = CreateThread(NULL, 0, PipeThread, NULL, 0, NULL);
    if (!thread) {
        logLine("create-thread-failed err=%lu", GetLastError());
        return 1;
    }

    MSG msg;
    while (GetMessageA(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageA(&msg);
    }

    KillTimer(g_hwnd, 1);
    DestroyWindow(g_hwnd);
    WaitForSingleObject(thread, 1000);
    CloseHandle(thread);
    logLine("destroy frames=%ld", g_frameCount);
    if (g_pipe != INVALID_HANDLE_VALUE) {
        DisconnectNamedPipe(g_pipe);
        CloseHandle(g_pipe);
    }
    if (g_dib) {
        if (g_memDc && g_stockBitmap) SelectObject(g_memDc, g_stockBitmap);
        DeleteObject(g_dib);
    }
    if (g_memDc) DeleteDC(g_memDc);
    if (g_log) fclose(g_log);
    DeleteCriticalSection(&g_dibLock);
    return 0;
}
