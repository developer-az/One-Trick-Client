import { ChampionIcon, ItemIcon } from '../components/GameIcons';
import { ChromeMark } from './ChromeMark';
import { layoutStyle, type HudSticker } from './hudLayout';

function StickerMark({ sticker }: { sticker: HudSticker }) {
  if (sticker.kind === 'champ' && sticker.championId) {
    return <ChampionIcon championId={sticker.championId} size={28} />;
  }
  if (sticker.kind === 'item' && sticker.itemId) {
    return <ItemIcon itemId={sticker.itemId} size={28} alt={sticker.label || sticker.itemId} />;
  }
  if (sticker.kind === 'text') {
    return <span className="hud-studio-sticker-text">{sticker.label || 'PIN'}</span>;
  }
  return <ChromeMark size={22} className="text-chrome-silver" />;
}

export function OverlayStickers({
  stickers,
  geo,
}: {
  stickers: HudSticker[];
  geo: { offsetX: number; offsetY: number; gameViewW: number; gameViewH: number };
}) {
  if (!stickers.length) return null;
  return (
    <>
      {stickers.map((sticker) => (
        <div key={sticker.id} className="hud-overlay-sticker" style={layoutStyle(sticker, geo)}>
          <StickerMark sticker={sticker} />
        </div>
      ))}
    </>
  );
}

export { StickerMark };
