import React, { useEffect, useMemo, useState } from 'react';
import {
  getDdragonVersion,
  itemIconSources,
  subscribeDdragonVersion,
} from '../data/ddragonAssets';
import { championAssetSources } from '../data/championCatalog';

function useDdragonVersion(): string {
  const [version, setVersion] = useState(getDdragonVersion);
  useEffect(() => subscribeDdragonVersion(() => setVersion(getDdragonVersion())), []);
  return version;
}

function FallbackImg({
  sources,
  className,
  alt,
  width,
  height,
  title,
  placeholder,
}: {
  sources: string[];
  className?: string;
  alt: string;
  width?: number;
  height?: number;
  title?: string;
  placeholder?: string;
}) {
  const [index, setIndex] = useState(0);

  if (!sources.length || index >= sources.length) {
    const mark = (placeholder || alt || '?').trim().slice(0, 2).toUpperCase() || '?';
    return (
      <span
        className={`hud-icon-fallback ${className || ''}`}
        title={title || alt}
        aria-label={alt}
        style={width && height ? { width, height, minWidth: width, minHeight: height } : undefined}
      >
        {mark}
      </span>
    );
  }

  return (
    <img
      src={sources[index]}
      alt={alt}
      title={title}
      width={width}
      height={height}
      className={className}
      decoding="async"
      draggable={false}
      style={width && height ? { width, height } : undefined}
      onError={() => setIndex((current) => current + 1)}
    />
  );
}

export const ChampionIcon: React.FC<{
  championId?: string | null;
  championName?: string | null;
  championKey?: string | number | null;
  className?: string;
  size?: number;
  alt?: string;
  title?: string;
}> = ({ championId, championName, championKey, className, size, alt, title }) => {
  const version = useDdragonVersion();
  const sources = useMemo(
    () => championAssetSources({ id: championId, name: championName, key: championKey }, version),
    [championId, championName, championKey, version]
  );
  const label = alt || championName || championId || 'Champion';

  return (
    <FallbackImg
      key={sources[0] || label}
      sources={sources}
      className={className}
      alt={label}
      title={title || label}
      width={size}
      height={size}
      placeholder={label}
    />
  );
};

export const ItemIcon: React.FC<{
  itemId: string | number;
  className?: string;
  alt?: string;
  title?: string;
  size?: number;
}> = ({ itemId, className, alt, title, size }) => {
  const version = useDdragonVersion();
  const sources = useMemo(() => itemIconSources(itemId, version), [itemId, version]);

  return (
    <FallbackImg
      key={sources[0] || String(itemId)}
      sources={sources}
      className={className}
      alt={alt || String(itemId)}
      title={title || alt}
      width={size}
      height={size}
      placeholder={alt || String(itemId)}
    />
  );
};
