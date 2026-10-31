import { DocsLayout } from '../components/DocsLayout'
import { siteHref } from '../lib/site'

export function OverlayPage() {
  return (
    <DocsLayout
      title="Overlay and hotkeys"
      lede="The HUD is click-through. PageUp and PageDown still work while League has focus."
    >
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0e0f14]/80 shadow-[0_12px_40px_rgba(0,0,0,0.3)] gothic-bracket">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-black/40 font-mono text-xs uppercase tracking-wider text-chrome-dim">
              <th className="px-6 py-3.5">Action</th>
              <th className="px-6 py-3.5">Control</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 font-sans">
            <tr className="hover:bg-white/[0.02] transition-colors">
              <td className="px-6 py-3.5 font-medium text-chrome-bright">Toggle primary Flash (ADC or Mid)</td>
              <td className="px-6 py-3.5 flex items-center gap-2">
                <kbd className="kbd-key">PageUp</kbd>
                <span className="text-xs text-chrome-dim">or</span>
                <kbd className="kbd-key">Num 9</kbd>
              </td>
            </tr>
            <tr className="hover:bg-white/[0.02] transition-colors">
              <td className="px-6 py-3.5 font-medium text-chrome-bright">Toggle Support Flash, or Mid Ignite / TP</td>
              <td className="px-6 py-3.5 flex items-center gap-2">
                <kbd className="kbd-key">PageDown</kbd>
                <span className="text-xs text-chrome-dim">or</span>
                <kbd className="kbd-key">Num 3</kbd>
              </td>
            </tr>
            <tr className="hover:bg-white/[0.02] transition-colors">
              <td className="px-6 py-3.5 font-medium text-chrome-bright">Show or hide the overlay</td>
              <td className="px-6 py-3.5 flex items-center gap-1.5">
                <kbd className="kbd-key">Ctrl</kbd>
                <span className="text-xs text-chrome-dim">+</span>
                <kbd className="kbd-key">Shift</kbd>
                <span className="text-xs text-chrome-dim">+</span>
                <kbd className="kbd-key">H</kbd>
              </td>
            </tr>
            <tr className="hover:bg-white/[0.02] transition-colors">
              <td className="px-6 py-3.5 font-medium text-chrome-bright">Lock click-through, or unlock the panel</td>
              <td className="px-6 py-3.5 flex items-center gap-1.5">
                <kbd className="kbd-key">Ctrl</kbd>
                <span className="text-xs text-chrome-dim">+</span>
                <kbd className="kbd-key">Shift</kbd>
                <span className="text-xs text-chrome-dim">+</span>
                <kbd className="kbd-key">U</kbd>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>HUD modules</h2>
      <p>
        Turn sums, gank, vision, buy, action, and frames on from the companion HUD row. Frames are off by default.
        Unlock the overlay and use Align, or Sync LoL, when the HUD scale does not match League. Sync reads
        Interface scales from game.cfg.
      </p>
      <p>
        The same layout can be edited in the <a href={siteHref('/studio/')}>HUD studio</a> and saved back into the
        app.
      </p>

      <h2>If the keys do nothing</h2>
      <p>
        PageUp and PageDown come from OneTrick&apos;s keyboard helper, a separate process with a keyboard-only hook.
        It does not see the mouse. If League was started as administrator, start One Trick as administrator too.
        Windows blocks a hook that crosses that privilege gap.
      </p>

      <h2>Performance</h2>
      <p>
        The overlay stays hidden until it has something to show. The Performance tab in the app can turn the in-game
        overlay off entirely. One Trick renders on the CPU unless you opt into the GPU switch.
      </p>
    </DocsLayout>
  )
}