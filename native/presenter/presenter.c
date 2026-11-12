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
    if (g_dib) {
        DeleteObject(g_dib);
        g_dib = NULL;
        g_bits = NULL;
    }
    BITMAPINFO bmi;
    memset(&bmi, 0, sizeof(bmi));
    bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth = w;
    bmi.bmiHeader.biHeight = -h; // top-down
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;
    HDC screen = GetDC(NULL);
    g_dib = CreateDIBSection(screen, &bmi, DIB_RGB_COLORS, &g_bits, NULL, 0);
    ReleaseDC(NULL, screen);
    if (!g_dib || !g_bits) return 0;
    if (!g_memDc) g_memDc = CreateCompatibleDC(NULL);
    SelectObject(g_memDc, g_dib);
    memset(g_bits, 0, (size_t)w * h * 4);
    g_w = w;
    g_h = h;
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

static void applyFrame(int x, int y, int w, int h, const BYTE *bgra) {
    if (!g_bits || x < 0 || y < 0 || w <= 0 || h <= 0) return;
    if (x + w > g_w) w = g_w - x;
    if (y + h > g_h) h = g_h - y;
    if (w <= 0 || h <= 0) return;
    EnterCriticalSection(&g_dibLock);
    BYTE *dst = (BYTE *)g_bits;
    for (int row = 0; row < h; row++) {
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
    if (w <= 0 || h <= 0) return;
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
        // Display geometry changed; Electron re-sends BOUNDS. Nothing to do here.
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
        if (len > 256 * 1024 * 1024) { // sanity cap: 256 MB
            logLine("oversize-message type=%lu len=%lu", type, len);
            break;
        }
        BYTE *payload = NULL;
        if (len > 0) {
            payload = (BYTE *)malloc(len);
            if (!payload) break;
            if (!readExact(g_pipe, payload, len)) {
                free(payload);
                break;
            }
        }
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
            if (len - 16 != (DWORD)((long long)w * h * 4)) {
                logLine("frame-size-mismatch rect=%lux%lu len=%lu", w, h, len);
                break;
            }
            applyFrame((int)x, (int)y, (int)w, (int)h, payload + 16);
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
        free(payload);
    }
    logLine("pipe-closed frames=%ld", g_frameCount);
    // Pipe broke: Electron is gone or respawning us. Exit; do not linger
    // as a stale topmost window over the game.
    PostMessageA(g_hwnd, WM_CLOSE, 0, 0);
    return 0;
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    (void)hPrevInstance;
    (void)lpCmdLine;
    (void)nCmdShow;
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
    logLine("created");

    g_pipe = CreateNamedPipeA(
        PIPE_NAME, PIPE_ACCESS_DUPLEX,
        PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
        1, 1 << 20, 1 << 20, 0, NULL);
    if (g_pipe == INVALID_HANDLE_VALUE) {
        logLine("create-pipe-failed err=%lu", GetLastError());
        return 1;
    }
    logLine("waiting-for-client");
    if (!ConnectNamedPipe(g_pipe, NULL) && GetLastError() != ERROR_PIPE_CONNECTED) {
        logLine("connect-pipe-failed err=%lu", GetLastError());
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

    logLine("destroy frames=%ld", g_frameCount);
    if (g_pipe != INVALID_HANDLE_VALUE) {
        DisconnectNamedPipe(g_pipe);
        CloseHandle(g_pipe);
    }
    if (g_dib) DeleteObject(g_dib);
    if (g_memDc) DeleteDC(g_memDc);
    if (g_log) fclose(g_log);
    DeleteCriticalSection(&g_dibLock);
    return 0;
}
