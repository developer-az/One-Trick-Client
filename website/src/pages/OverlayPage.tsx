import { DocsLayout } from '../components/DocsLayout'
import { siteHref } from '../lib/site'

export function OverlayPage() {
  return (
    <DocsLayout
      title="Overlay and hotkeys"
      lede="The HUD is click-through. PageUp and PageDown still work while League has focus."
    >
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Control</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Toggle primary Flash (ADC or Mid)</td>
            <td>PageUp or Numpad 9</td>
          </tr>
          <tr>
            <td>Toggle Support Flash, or Mid Ignite / TP</td>
            <td>PageDown or Numpad 3</td>
          </tr>
          <tr>
            <td>Show or hide the overlay</td>
            <td>Ctrl+Shift+H</td>
          </tr>
          <tr>
            <td>Lock click-through, or unlock the panel</td>
            <td>Ctrl+Shift+U</td>
          </tr>
        </tbody>
      </table>

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
