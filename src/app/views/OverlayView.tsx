import React, { useCallback, useEffect, useState } from 'react';
import { HudStudio } from '../../components/HudStudio';
import { CHROME_COLOR_PRESETS, normalizeChromeColor } from '../../overlay/chromeTheme';
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
import { isDesktop, useAppSettings } from '../hooks';
import { SpellTimers } from '../SpellTimers';
import { Card, CardHeader, SettingRow, Switch } from '../ui';

const MODULE_INFO: Record<HudModuleId, { title: string; hint: string }> = {
  sums: { title: 'Summoner timers', hint: 'Enemy Flash and other spell cooldowns next to the minimap.' },
  gank: { title: 'Gank warning', hint: 'A coloured square estimating how likely a jungle gank is right now.' },
  vision: { title: 'Vision', hint: 'Where to ward next, and when a ward is due.' },
  buy: { title: 'Next buy', hint: 'The next items left on your build path.' },
  action: { title: 'Next move', hint: 'Short calls for what to do next, ranked by urgency.' },
  frames: { title: 'Frames', hint: 'Decorative borders around the overlay panels.' },
};

interface OverlayControls {
  visible: boolean;
  clickThrough: boolean;
  hudScale: number;
  mapScale: number;
  chromeColor: string;
  modules: HudModules;
  layout: HudLayout;
}

function useOverlayControls() {
  const [state, setState] = useState<OverlayControls>(() => ({
    visible: true,
    clickThrough: true,
    hudScale: 20,
    mapScale: 33,
    chromeColor: '#d4d8de',
    modules: DEFAULT_HUD_MODULES,
    layout: typeof window !== 'undefined' ? loadStoredHudLayout() : dualRailLayout(),
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
        layout: layout || s.layout,
        modules: res.hudModules ? normalizeHudModules(res.hudModules) : layout ? normalizeHudModules(Object.fromEntries(layout.elements.map((e) => [e.id, e.visible]))) : s.modules,
      }));
    });
    const unsubVis = api.onOverlayVisibilityChanged?.((p) => patch({ visible: p.visible }));
    const unsubMeta = api.onOverlayMeta?.((payload) => {
      const meta = payload as Partial<{ clickThrough: boolean; hudScale: number; mapScale: number; chromeColor: string; hudModules: unknown; hudLayout: unknown }>;
      const next: Partial<OverlayControls> = {};
      if (typeof meta.clickThrough === 'boolean') next.clickThrough = meta.clickThrough;
      if (typeof meta.hudScale === 'number') next.hudScale = meta.hudScale;
      if (typeof meta.mapScale === 'number') next.mapScale = meta.mapScale;
      if (typeof meta.chromeColor === 'string') next.chromeColor = meta.chromeColor;
      if (meta.hudModules) next.modules = normalizeHudModules(meta.hudModules);
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
  const api = window.electronAPI;

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

  const chrome = normalizeChromeColor(state.chromeColor);

  return (
    <div className="ot-page">
      <div className="ot-page-header">
        <div>
          <h1 className="ot-page-title">In-game overlay</h1>
          <p className="ot-page-sub">
            Small panels over League that only appear when they have something to show. Windows stay hidden otherwise,
            so the game keeps its frame rate.
          </p>
        </div>
      </div>

      {!isDesktop ? (
        <div className="ot-callout mb-5">The overlay runs in the desktop app. You can still arrange the layout below.</div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="General" />
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
          <div className="grid gap-x-8 md:grid-cols-2">
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

const Slider: React.FC<{ label: string; value: number; onChange: (v: number) => void }> = ({ label, value, onChange }) => (
  <label className="block py-2">
    <div className="flex justify-between text-[15px] mb-1.5">
      <span className="font-medium">{label}</span>
      <span className="ot-muted ot-num">{value}</span>
    </div>
    <input type="range" min={0} max={100} value={value} className="ot-range" onChange={(e) => onChange(Number(e.target.value))} />
  </label>
);
