import React, { useEffect, useMemo, useState } from 'react';
import { normalizeChromeColor } from './chromeTheme';
import { computeLeagueGeometry } from './leagueGeometry';

/**
 * League anchors the bottom HUD cluster (spells/items/portrait) to bottom-center
 * and the minimap to bottom-right inside the *game* viewport.
 *
 * Critical: when game.cfg Width/Height ≠ the overlay display (letterbox / pillarbox),
 * frames must be positioned inside the rendered game rect — not the raw window.
 *
 * GlobalScale ~0–1 → hudScale 0–100.
 * MinimapScale ~0.5–2.0 → mapScale 0–100 via 0.5 + (slider/100)*1.5.
 */
function useLeagueGeometry(
  hudScale: number,
  mapScale: number,
  gameWidth?: number,
  gameHeight?: number
) {
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 1080));
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1920));

  useEffect(() => {
    const onResize = () => {
      setVh(window.innerHeight);
      setVw(window.innerWidth);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return useMemo(
    () => computeLeagueGeometry({ vw, vh, hudScale, mapScale, gameWidth, gameHeight }),
    [vh, vw, hudScale, mapScale, gameWidth, gameHeight]
  );
}

function ThornTip({ style }: { style?: React.CSSProperties }) {
  return <span className="chrome-thorn-tip" style={style} aria-hidden />;
}

function CornerBrackets({
  color,
  armLength = 18,
}: {
  color: string;
  armLength?: number;
}) {
  const corners: Array<{ key: string; style: React.CSSProperties; tip: React.CSSProperties }> = [
    {
      key: 'tl',
      style: { top: 0, left: 0, borderTop: '2px solid', borderLeft: '2px solid' },
      tip: { top: -3, left: -3 },
    },
    {
      key: 'tr',
      style: { top: 0, right: 0, borderTop: '2px solid', borderRight: '2px solid' },
      tip: { top: -3, right: -3 },
    },
    {
      key: 'bl',
      style: { bottom: 0, left: 0, borderBottom: '2px solid', borderLeft: '2px solid' },
      tip: { bottom: -3, left: -3 },
    },
    {
      key: 'br',
      style: { bottom: 0, right: 0, borderBottom: '2px solid', borderRight: '2px solid' },
      tip: { bottom: -3, right: -3 },
    },
  ];

  return (
    <>
      {corners.map((c) => (
        <span
          key={c.key}
          className="chrome-corner-bracket"
          style={{ width: armLength, height: armLength, borderColor: color, ...c.style }}
        >
          <ThornTip style={{ ...c.tip, background: color }} />
        </span>
      ))}
    </>
  );
}

/** Mid-edge ticks so the frame reads as a calibrated HUD mark, not a bare box. */
function EdgeTicks({ color }: { color: string }) {
  return (
    <>
      <span className="chrome-edge-tick chrome-edge-tick--top" style={{ background: color }} />
      <span className="chrome-edge-tick chrome-edge-tick--bottom" style={{ background: color }} />
      <span className="chrome-edge-tick chrome-edge-tick--left" style={{ background: color }} />
      <span className="chrome-edge-tick chrome-edge-tick--right" style={{ background: color }} />
    </>
  );
}

export const ChromeGameHud: React.FC<{
  hudScale?: number;
  mapScale?: number;
  enabled?: boolean;
  chromeColor?: string;
  calibration?: OverlayCalibration;
  showGuides?: boolean;
  gameWidth?: number;
  gameHeight?: number;
}> = ({
  hudScale = 20,
  mapScale = 33,
  enabled = true,
  chromeColor = '#d4d8de',
  calibration,
  showGuides = false,
  gameWidth,
  gameHeight,
}) => {
  const geo = useLeagueGeometry(hudScale, mapScale, gameWidth, gameHeight);
  const color = normalizeChromeColor(chromeColor);
  const abilityCal = calibration?.ability ?? { dx: 0, dy: 0, dw: 0, dh: 0 };
  const mapCal = calibration?.minimap ?? { dx: 0, dy: 0, dw: 0, dh: 0 };

  if (!enabled) return null;

  const abilityWidth = Math.max(40, geo.abilityW + abilityCal.dw);
  const abilityHeight = Math.max(24, geo.abilityH + abilityCal.dh);
  const mapW = Math.max(60, geo.mapSize + mapCal.dw);
  const mapH = Math.max(60, geo.mapSize + mapCal.dh);

  const abilityBottom = geo.displayBottomInset + geo.abilityBottomPad + abilityCal.dy;
  const mapBottom = geo.displayBottomInset + geo.mapPad + mapCal.dy;
  const mapRight = geo.displayRightInset + geo.mapPad - mapCal.dx;

  return (
    <div className="chrome-game-hud" aria-hidden style={{ ['--chrome-frame-color' as string]: color }}>
      {/* Soft game-viewport outline in align mode so letterboxing is obvious */}
      {showGuides && (
        <div
          className="chrome-game-viewport"
          style={{
            left: geo.offsetX,
            top: geo.offsetY,
            width: geo.gameViewW,
            height: geo.gameViewH,
          }}
        />
      )}

      <div
        className={`chrome-frame-box chrome-frame-ability ${showGuides ? 'chrome-frame-guide' : 'chrome-frame-live'}`}
        style={{
          left: geo.offsetX + geo.gameViewW / 2 + abilityCal.dx,
          bottom: abilityBottom,
          width: abilityWidth,
          height: abilityHeight,
          transform: 'translateX(-50%)',
        }}
      >
        <div className="chrome-frame-inner" />
        <CornerBrackets color={color} armLength={Math.max(14, Math.round(16 * geo.s))} />
        <EdgeTicks color={color} />
        {showGuides && (
          <span className="chrome-frame-label">
            Ability HUD
            <br />
            {abilityWidth}×{abilityHeight} · HUD {geo.safeHud}
          </span>
        )}
      </div>

      <div
        className={`chrome-frame-box chrome-frame-map ${showGuides ? 'chrome-frame-guide chrome-frame-guide-map' : 'chrome-frame-live'}`}
        style={{
          right: mapRight,
          bottom: mapBottom,
          width: mapW,
          height: mapH,
        }}
      >
        <div className="chrome-frame-inner chrome-frame-inner--map" />
        <CornerBrackets color={color} armLength={Math.max(16, Math.round(20 * geo.s))} />
        <EdgeTicks color={color} />
        {showGuides && (
          <span className="chrome-frame-label">
            Minimap
            <br />
            {mapW}×{mapH} · Map {geo.safeMap}
          </span>
        )}
      </div>

      {showGuides && (
        <div className="chrome-align-banner">
          Align frames to League HUD + minimap · Sync LoL first · Nudge until edges match
          {` · game ${geo.refW}×${geo.refH}`}
          {geo.offsetX > 2 || geo.offsetY > 2 ? ` · letterbox ${geo.offsetX}×${geo.offsetY}` : ''}
        </div>
      )}
    </div>
  );
};
