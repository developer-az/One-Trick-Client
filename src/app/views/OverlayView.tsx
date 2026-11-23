import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { HudStudio } from '../../components/HudStudio';
import { CHROME_COLOR_PRESETS, normalizeChromeColor } from '../../overlay/chromeTheme';
import { HudSkinPreview, HudStudioCanvas } from '../../overlay/HudStudioCanvas';
import {
  HUD_SKIN_CHOICES,
  HUD_SKIN_CLASS,
  HUD_SKIN_HINTS,
  HUD_SKIN_LABELS,
  DEFAULT_HUD_SKIN_SETTINGS,
  normalizeHudSkinSettings,
  resolveHudSkin,
  type HudSkinSettings,
} from '../../overlay/hudSkins';
import {
  applyModulesToLayout,
  dualRailLayout,
  loadStoredHudLayout,
  normalizeHudLayout,
  storeHudLayout,
  type HudLayout,
} from '../../overlay/hudLayout';
import {
  DEFAULT_HUD_MODULES,
  HUD_MODULE_IDS,
  normalizeHudModules,
  type HudModuleId,
  type HudModules,
} from '../../overlay/hudModules';
import type { OverlayBotSummoner } from '../../overlay/overlayLogic';
import { isDesktop, useAppSettings, useCatalog } from '../hooks';
import { SpellTimers } from '../SpellTimers';
import { Card, CardHeader, SettingRow, Switch } from '../ui';

const MODULE_INFO: Record<HudModuleId, { title: string; hint: string }> = {
  sums: { title: 'Summoner timers', hint: 'SR: enemy Flash/ignite by lane. Off on Howling Abyss / ARAM.' },
  gank: { title: 'Gank warning', hint: 'SR: jungle pressure. Hidden on Howling Abyss / ARAM.' },
  vision: { title: 'Vision', hint: 'SR: lane wards. ARAM Mayhem: augment picks use this slot instead of sweeper hints.' },
  buy: { title: 'Next buy', hint: 'The next items left on your build path.' },
  action: { title: 'Next move', hint: 'Short calls for what to do next, ranked by urgency.' },
  mayhem: {
    title: 'ARAM Mayhem (beta)',
    hint: 'Mayhem only: OCR on augment cards (Windows). Off by default — enable for ARAM Mayhem queues.',
  },
  frames: { title: 'Frames', hint: 'Game HUD + minimap frame/skin: paints the selected HUD skin around the health, mana and ability bar.' },
};

interface OverlayControls {
  visible: boolean;
  clickThrough: boolean;
  hudScale: number;
  mapScale: number;
  chromeColor: string;
  overlayTextScale: number;
  modules: HudModules;
  layout: HudLayout;
  hudSkin: HudSkinSettings;
}

function useOverlayControls() {
  const [state, setState] = useState<OverlayControls>(() => ({
    visible: true,
    clickThrough: true,
    hudScale: 20,
    mapScale: 33,
    chromeColor: '#d4d8de',
    overlayTextScale: 1,
    modules: DEFAULT_HUD_MODULES,
    layout: typeof window !== 'undefined' ? loadStoredHudLayout() : dualRailLayout(),
    hudSkin: DEFAULT_HUD_SKIN_SETTINGS,
  }));
  const patch = useCallback((next: Partial<OverlayControls>) => setState((s) => ({ ...s, ...next })), []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    void api.getOverlayStatus?.().then((res) => {
      if (!res?.success) return;
      const layout = res.hudLayout ? normalizeHudLayout(res.hudLayout) : undefined;
      if (layout) storeHudLayout(layout);
      setState((s) => ({
        ...s,
        visible: res.visible,
        clickThrough: res.clickThrough,
        hudScale: res.hudScale,
        mapScale: typeof res.mapScale === 'number' ? res.mapScale : s.mapScale,
        chromeColor: res.chromeColor || s.chromeColor,
        overlayTextScale: typeof res.overlayTextScale === 'number' ? res.overlayTextScale : s.overlayTextScale,
        layout: layout || s.layout,
        hudSkin: res.hudSkin ? normalizeHudSkinSettings(res.hudSkin) : s.hudSkin,
        modules: res.hudModules ? normalizeHudModules(res.hudModules) : layout ? normalizeHudModules(Object.fromEntries(layout.elements.map((e) => [e.id, e.visible]))) : s.modules,
      }));
    });
    const unsubVis = api.onOverlayVisibilityChanged?.((p) => patch({ visible: p.visible }));
    const unsubMeta = api.onOverlayMeta?.((payload) => {
      const meta = payload as Partial<{ clickThrough: boolean; hudScale: number; mapScale: number; chromeColor: string; overlayTextScale: number; hudModules: unknown; hudLayout: unknown; hudSkin: unknown }>;
      const next: Partial<OverlayControls> = {};
      if (typeof meta.clickThrough === 'boolean') next.clickThrough = meta.clickThrough;
      if (typeof meta.hudScale === 'number') next.hudScale = meta.hudScale;
      if (typeof meta.mapScale === 'number') next.mapScale = meta.mapScale;
      if (typeof meta.chromeColor === 'string') next.chromeColor = meta.chromeColor;
      if (typeof meta.overlayTextScale === 'number') next.overlayTextScale = meta.overlayTextScale;
      if (meta.hudModules) next.modules = normalizeHudModules(meta.hudModules);
      if (meta.hudSkin) next.hudSkin = normalizeHudSkinSettings(meta.hudSkin);
      if (meta.hudLayout) {
        next.layout = normalizeHudLayout(meta.hudLayout);
        storeHudLayout(next.layout);
      }
      patch(next);
    });
    return () => {
      if (typeof unsubVis === 'function') unsubVis();
      if (typeof unsubMeta === 'function') unsubMeta();
    };
  }, [patch]);

  return { state, patch };
}

export const OverlayView: React.FC<{ inGame: boolean; summoners: OverlayBotSummoner[] }> = ({ inGame, summoners }) => {
  const { settings, update } = useAppSettings();
  const { state, patch } = useOverlayControls();
  const { champions } = useCatalog();
  const api = window.electronAPI;
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then((v) => setAppVersion(v)).catch(() => undefined);
  }, []);

  const setModules = (modules: HudModules, layout = applyModulesToLayout(state.layout, modules)) => {
    patch({ modules, layout });
    storeHudLayout(layout);
    void api?.setOverlayHudModules?.(modules);
    void api?.setOverlayHudLayout?.(layout);
  };

  const setLayout = (next: HudLayout) => {
    const layout = normalizeHudLayout(next);
    const modules = { ...state.modules };
    for (const el of layout.elements) if (el.id in modules) modules[el.id as HudModuleId] = el.visible;
    setModules(modules, layout);
  };

  const setScale = (kind: 'hud' | 'map', value: number) => {
    if (kind === 'hud') {
      patch({ hudScale: value });
      void api?.setOverlayHudScale?.(value);
    } else {
      patch({ mapScale: value });
      void api?.setOverlayMapScale?.(value);
    }
  };

  const setChrome = (color: string) => {
    patch({ chromeColor: color });
    void api?.setOverlayChromeColor?.(color);
  };

  const setTextScale = (value: number) => {
    patch({ overlayTextScale: value });
    void api?.setOverlayTextScale?.(value);
  };

  const setSkin = (next: Partial<HudSkinSettings>) => {
    const value = normalizeHudSkinSettings({ ...state.hudSkin, ...next });
    patch({ hudSkin: value });
    void api?.setOverlayHudSkin?.(value);
  };

  const chrome = normalizeChromeColor(state.chromeColor);

  // Auto resolution for the settings previews: the app's main champion is the
  // closest stand-in for the in-game pick (the overlay itself resolves the
  // live champion).
  const mainChampionTags = useMemo(() => {
    const name = (settings?.appearance?.mainChampion || '').toLowerCase();
    if (!name || !champions.length) return [] as string[];
    const champ = champions.find((c) => c.id.toLowerCase() === name || c.name.toLowerCase() === name);
    return champ?.tags || [];
  }, [champions, settings?.appearance?.mainChampion]);
  const previewSkin = resolveHudSkin(state.hudSkin.hudSkin, mainChampionTags);

  return (
    <div className="ot-page">
      <div className="ot-page-header">
        <div>
          <h1 className="ot-page-title ot-orn-title">In-game overlay</h1>
          <p className="ot-page-sub">
            Small panels over League that only appear when they have something to show. Windows stay hidden otherwise,
            so the game keeps its frame rate.
          </p>
        </div>
      </div>

      {!isDesktop ? (
        <div className="ot-callout mb-4">The overlay runs in the desktop app. You can still arrange the layout below.</div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="General" />
          <SettingRow
            title="Version"
            hint="Installed client build."
            control={<span className="ot-muted">{appVersion ? `v${appVersion}` : '—'}</span>}
          />
          <SettingRow
            title="Overlay in matches"
            hint="Master switch. Off means nothing is ever drawn over League."
            control={
              <Switch
                label="Overlay in matches"
                checked={!!settings?.overlayEnabled}
                disabled={!settings}
                onChange={(v) => update({ overlayEnabled: v })}
              />
            }
          />
          <SettingRow
            title="Only while holding Tab"
            hint="Shows the overlay with the scoreboard and keeps League uncovered the rest of the time."
            control={
              <Switch
                label="Only while holding Tab"
                checked={!!settings?.overlayHoldToShow}
                disabled={!settings || settings.overlayEnabled === false}
                onChange={(v) => update({ overlayHoldToShow: v })}
              />
            }
          />
          <SettingRow
            title="Hide from recordings"
            hint="Keeps the overlay out of screenshots, clips and streams. You still see it."
            control={
              <Switch
                label="Hide from recordings"
                checked={settings?.overlayHideFromCapture !== false}
                disabled={!settings || settings.overlayEnabled === false}
                onChange={(v) => update({ overlayHideFromCapture: v })}
              />
            }
          />
          <SettingRow
            title="Show right now"
            hint={inGame ? 'Hide or show it for this match.' : 'Takes effect when a match starts.'}
            control={
              <Switch
                label="Show overlay"
                checked={state.visible}
                disabled={!isDesktop || settings?.overlayEnabled === false}
                onChange={(v) => {
                  patch({ visible: v });
                  void api?.setOverlayVisible?.(v).then((r) => r?.success && patch({ visible: r.visible }));
                }}
              />
            }
          />
          <SettingRow
            title="Move panels"
            hint="Unlock to drag the overlay in game. Lock it again so clicks pass through to League."
            control={
              <Switch
                label="Unlock overlay"
                checked={!state.clickThrough}
                disabled={!isDesktop}
                onChange={() => void api?.toggleOverlayClickThrough?.().then((r) => r?.success && patch({ clickThrough: r.clickThrough }))}
              />
            }
          />
        </Card>

        <Card>
          <CardHeader title="Hotkeys" sub="Work while League has focus." />
          <dl className="space-y-2.5 text-sm">
            <Hotkey keys={['Page Up']} alt="Num 9" label="Enemy ADC used Flash" />
            <Hotkey keys={['Page Down']} alt="Num 3" label="Enemy support used Flash" />
            <Hotkey keys={['Ctrl', 'Shift', 'H']} label="Show or hide overlay" />
            <Hotkey keys={['Ctrl', 'Shift', 'U']} label="Unlock overlay to move it" />
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Match League's interface"
            sub="Use the same values as League's Interface settings so panels line up."
            action={
              isDesktop ? (
                <button
                  type="button"
                  className="ot-btn ot-btn-sm"
                  onClick={() =>
                    void api?.syncLeagueScales?.().then((r) => r?.success && patch({ hudScale: r.hudScale, mapScale: r.mapScale }))
                  }
                  title="Read HUD and minimap scale from League's game.cfg"
                >
                  Read from League
                </button>
              ) : null
            }
          />
          <Slider label="HUD scale" value={state.hudScale} onChange={(v) => setScale('hud', v)} />
          <Slider label="Minimap scale" value={state.mapScale} onChange={(v) => setScale('map', v)} />
          <label className="block py-2">
            <div className="flex justify-between text-[15px] mb-1.5">
              <span className="font-medium">Overlay text size</span>
              <span className="ot-muted ot-num">{Math.round((state.overlayTextScale ?? 1) * 100)}%</span>
            </div>
            <input
              type="range"
              min={85}
              max={160}
              step={5}
              value={Math.round((state.overlayTextScale ?? 1) * 100)}
              className="ot-range"
              onChange={(e) => setTextScale(Number(e.target.value) / 100)}
            />
            <p className="mt-1 text-xs ot-faint leading-relaxed">
              Scales overlay type only. Panels stay where you placed them — useful on 1440p and above.
            </p>
          </label>
          <div className="mt-4">
            <div className="text-[15px] font-medium mb-2">Accent colour</div>
            <div className="flex flex-wrap items-center gap-2">
              {CHROME_COLOR_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.label}
                  aria-label={p.label}
                  aria-pressed={chrome === p.value.toLowerCase()}
                  onClick={() => setChrome(p.value)}
                  className="w-7 h-7 rounded-full border-2"
                  style={{ background: p.value, borderColor: chrome === p.value.toLowerCase() ? 'var(--ot-text)' : 'transparent' }}
                />
              ))}
              <label className="ot-btn ot-btn-sm ot-btn-ghost cursor-pointer">
                Custom
                <input type="color" className="w-5 h-5 bg-transparent" value={chrome} onChange={(e) => setChrome(e.target.value)} />
              </label>
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Panels" sub="Turn off anything you don't use. Fewer panels means less drawing over the game." />
          <div className="grid gap-x-4 md:grid-cols-2">
            {HUD_MODULE_IDS.map((id) => (
              <SettingRow
                key={id}
                title={MODULE_INFO[id].title}
                hint={MODULE_INFO[id].hint}
                control={
                  <Switch
                    label={MODULE_INFO[id].title}
                    checked={state.modules[id]}
                    onChange={(v) => setModules({ ...state.modules, [id]: v })}
                  />
                }
              />
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="HUD Skin"
            sub="Frames, corners and marks for the panels. Decoration only — panels stay exactly where you placed them and every value keeps its meaning."
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {HUD_SKIN_CHOICES.map((choice) => {
              const active = state.hudSkin.hudSkin === choice;
              return (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSkin({ hudSkin: choice })}
                  className={`text-left rounded-[var(--ot-radius)] border p-2 transition-colors duration-150 ${
                    active
                      ? 'border-[var(--ot-border-bright)] bg-[var(--ot-surface-2)]'
                      : 'border-[var(--ot-border)] bg-[var(--ot-surface)]'
                  }`}
                >
                  <HudSkinPreview skin={resolveHudSkin(choice, mainChampionTags)} settings={state.hudSkin} />
                  <span className="mt-2 block text-[13px] font-semibold">{HUD_SKIN_LABELS[choice]}</span>
                  <span className="block text-xs ot-muted leading-snug">
                    {choice === 'auto' ? 'By class' : HUD_SKIN_CLASS[choice]} · {HUD_SKIN_HINTS[choice]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-x-4 md:grid-cols-2">
            <SettingRow
              title="Corner ornaments"
              hint="The skin's corner marks and header emblems. Off keeps the plain frame."
              control={
                <Switch
                  label="Corner ornaments"
                  checked={state.hudSkin.hudSkinOrnaments}
                  onChange={(v) => setSkin({ hudSkinOrnaments: v })}
                />
              }
            />
            <SettingRow
              title="Tint marks with champion"
              hint="Ornaments follow the champion's accent. Off keeps chrome silver."
              control={
                <Switch
                  label="Tint marks with champion"
                  checked={state.hudSkin.hudSkinUseChampColor}
                  onChange={(v) => setSkin({ hudSkinUseChampColor: v })}
                />
              }
            />
            <SkinSlider
              label="Panel opacity"
              value={state.hudSkin.hudSkinOpacity}
              min={80}
              max={100}
              step={1}
              onChange={(v) => setSkin({ hudSkinOpacity: v })}
              hint="Never below 80% so text stays readable over the map."
            />
            <SkinSlider
              label="Ornament size"
              value={state.hudSkin.hudSkinScale}
              min={75}
              max={150}
              step={5}
              onChange={(v) => setSkin({ hudSkinScale: v })}
              hint="Scales the corner marks only — not the panel or its text."
            />
          </div>

          <div className="mt-4 max-w-[560px]">
            <div className="text-xs ot-faint uppercase tracking-wide mb-2">Live HUD stage · {HUD_SKIN_LABELS[previewSkin]}</div>
            <div className="hud-studio-wrap">
              <HudStudioCanvas
                layout={state.layout}
                editable={false}
                chromeColor={state.chromeColor}
                hudScale={state.hudScale}
                mapScale={state.mapScale}
                skin={previewSkin}
                skinSettings={state.hudSkin}
              />
            </div>
          </div>
        </Card>

        {inGame && summoners.length ? (
          <Card className="lg:col-span-2">
            <CardHeader title="Enemy summoners" />
            <SpellTimers lanes={summoners} />
          </Card>
        ) : null}

        <div className="lg:col-span-2 ot-studio-embed">
          <HudStudio
            layout={state.layout}
            onLayoutChange={setLayout}
            chromeColor={state.chromeColor}
            hudScale={state.hudScale}
            mapScale={state.mapScale}
          />
        </div>
      </div>
    </div>
  );
};


const Hotkey: React.FC<{ keys: string[]; alt?: string; label: string }> = ({ keys, alt, label }) => (
  <div className="flex items-center justify-between gap-4">
    <dt className="ot-muted">{label}</dt>
    <dd className="flex gap-1 flex-none">
      {keys.map((k) => (
        <kbd key={k} className="ot-kbd">
          {k}
        </kbd>
      ))}
      {alt ? (
        <>
          <span className="ot-faint text-xs self-center px-0.5">or</span>
          <kbd className="ot-kbd">{alt}</kbd>
        </>
      ) : null}
    </dd>
  </div>
);
const Slider: React.FC<{ label: string; value: number; onChange: (v: number) => void }> = ({ label, value, onChange }) => (
  <label className="block py-2">
    <div className="flex justify-between text-[15px] mb-1.5">
      <span className="font-medium">{label}</span>
      <span className="ot-muted ot-num">{value}</span>
    </div>
    <input type="range" min={0} max={100} value={value} className="ot-range" onChange={(e) => onChange(Number(e.target.value))} />
  </label>
);

/** Range row for a HUD skin tweak (percent value shown on the right). */
const SkinSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, hint, onChange }) => (
  <label className="block py-2">
    <div className="flex justify-between text-[15px] mb-1.5">
      <span className="font-medium">{label}</span>
      <span className="ot-muted ot-num">{value}%</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      className="ot-range"
      onChange={(e) => onChange(Number(e.target.value))}
    />
    <p className="mt-1 text-xs ot-faint leading-relaxed">{hint}</p>
  </label>
);
