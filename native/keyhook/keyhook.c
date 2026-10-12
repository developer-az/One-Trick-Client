/*
 * onetrick-keys.exe — keyboard-only global hotkey helper for One Trick.
 *
 * Why this exists: the previous hotkey path (uiohook-napi) installs BOTH a
 * WH_KEYBOARD_LL and a WH_MOUSE_LL hook. A low-level mouse hook puts this app
 * in the path of every mouse movement on the system (1000-8000 events/s on a
 * gaming mouse), and each one was turned into a JS object on Electron's main
 * thread. One Trick only ever needs four keys, so this helper hooks the
 * keyboard and nothing else.
 *
 * Protocol (stdout, one ASCII line per event):
 *   R            hook installed and running
 *   E <code>     SetWindowsHookEx failed with GetLastError() == code; exits 1
 *   P            primary key went down   (PageUp, Numpad 9, NumLock-off Numpad 9)
 *   S            secondary key went down (PageDown, Numpad 3, NumLock-off Numpad 3)
 *
 * The helper exits as soon as its stdin closes, so it can never outlive the app.
 *
 * Design notes:
 * - The hook callback never blocks: it only posts a message to a writer
 *   thread. Windows waits for LL hook callbacks before delivering input to
 *   the game, so the callback must return in microseconds.
 * - Auto-repeat is filtered (a held key fires once).
 * - Keys are observed, never swallowed: CallNextHookEx is always called.
 * - Windows silently removes an LL hook whose callback ever misses
 *   LowLevelHooksTimeout (possible when a game pegs every core), so the hook
 *   is re-installed every 30 s from a timer on the hook thread.
 *
 * Build: x86_64-w64-mingw32-gcc -O2 -s -mwindows -o onetrick-keys.exe keyhook.c
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#define WM_KEYHOOK_EVENT (WM_APP + 1)

static HHOOK g_hook = NULL;
static DWORD g_writer_thread_id = 0;
static HANDLE g_stdout = INVALID_HANDLE_VALUE;
static BOOL g_down[256];

static void write_line(const char *line, DWORD len) {
    DWORD written = 0;
    if (g_stdout == INVALID_HANDLE_VALUE) return;
    if (!WriteFile(g_stdout, line, len, &written, NULL)) {
        /* Parent is gone. */
        ExitProcess(0);
    }
}

static char classify(DWORD vk) {
    switch (vk) {
    case VK_PRIOR:   /* PageUp, and Numpad 9 with NumLock off */
    case VK_NUMPAD9:
        return 'P';
    case VK_NEXT:    /* PageDown, and Numpad 3 with NumLock off */
    case VK_NUMPAD3:
        return 'S';
    default:
        return 0;
    }
}

static LRESULT CALLBACK keyboard_proc(int code, WPARAM wParam, LPARAM lParam) {
    if (code == HC_ACTION) {
        const KBDLLHOOKSTRUCT *k = (const KBDLLHOOKSTRUCT *)lParam;
        DWORD vk = k->vkCode & 0xFF;
        char kind = classify(vk);
        if (kind) {
            if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) {
                if (!g_down[vk]) {
                    g_down[vk] = TRUE;
                    PostThreadMessage(g_writer_thread_id, WM_KEYHOOK_EVENT, (WPARAM)kind, 0);
                }
            } else if (wParam == WM_KEYUP || wParam == WM_SYSKEYUP) {
                g_down[vk] = FALSE;
            }
        }
    }
    return CallNextHookEx(g_hook, code, wParam, lParam);
}

static DWORD WINAPI writer_thread(LPVOID unused) {
    MSG msg;
    (void)unused;
    /* Force creation of this thread's message queue before signalling ready. */
    PeekMessage(&msg, NULL, WM_USER, WM_USER, PM_NOREMOVE);
    while (GetMessage(&msg, NULL, 0, 0) > 0) {
        if (msg.message == WM_KEYHOOK_EVENT) {
            char line[2];
            line[0] = (char)msg.wParam;
            line[1] = '\n';
            write_line(line, 2);
        }
    }
    return 0;
}

static DWORD WINAPI stdin_watch_thread(LPVOID unused) {
    HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
    char buf[64];
    DWORD got = 0;
    (void)unused;
    for (;;) {
        if (in == INVALID_HANDLE_VALUE || in == NULL) break;
        if (!ReadFile(in, buf, sizeof(buf), &got, NULL) || got == 0) break;
    }
    ExitProcess(0);
    return 0;
}

int WINAPI WinMain(HINSTANCE hInst, HINSTANCE hPrev, LPSTR cmd, int show) {
    MSG msg;
    HANDLE writer;
    (void)hPrev;
    (void)cmd;
    (void)show;

    g_stdout = GetStdHandle(STD_OUTPUT_HANDLE);

    /* The hook thread must answer fast or Windows delays all keyboard input. */
    SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS);
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);

    writer = CreateThread(NULL, 0, writer_thread, NULL, 0, &g_writer_thread_id);
    if (!writer) return 1;
    /* Give the writer a moment to create its queue so early posts aren't lost. */
    Sleep(10);
    CreateThread(NULL, 0, stdin_watch_thread, NULL, 0, NULL);

    g_hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_proc, hInst, 0);
    if (!g_hook) {
        char line[32];
        int len = wsprintfA(line, "E %lu\n", GetLastError());
        write_line(line, (DWORD)len);
        return 1;
    }
    write_line("R\n", 2);
    SetTimer(NULL, 0, 30000, NULL);

    while (GetMessage(&msg, NULL, 0, 0) > 0) {
        if (msg.message == WM_TIMER) {
            HHOOK fresh = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_proc, hInst, 0);
            if (fresh) {
                HHOOK old = g_hook;
                g_hook = fresh;
                UnhookWindowsHookEx(old);
            }
            continue;
        }
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    UnhookWindowsHookEx(g_hook);
    return 0;
}
