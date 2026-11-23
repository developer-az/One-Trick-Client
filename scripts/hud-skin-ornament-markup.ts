/** Prints the ornament markup per skin as JSON (used by verify:hud-skins-dom). */
import { HUD_SKIN_IDS } from '../src/overlay/hudSkins';
import {
  ORNAMENT_CORNERS,
  ornamentEmblemSource,
  ornamentSvgSource,
} from '../src/overlay/hudSkinOrnaments';

const out: Record<string, { corners: Record<string, string>; emblem: string }> = {};
for (const skin of HUD_SKIN_IDS) {
  out[skin] = {
    corners: Object.fromEntries(
      ORNAMENT_CORNERS.map((corner) => [corner, ornamentSvgSource(skin, corner)])
    ),
    emblem: ornamentEmblemSource(skin),
  };
}
console.log(JSON.stringify(out));
