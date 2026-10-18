import { useCallback, useEffect, useState } from 'react';
import type { MayhemBundle } from '../../logic/mayhem/types';
import bundled from '../../data/mayhem/bundle.json';
import { sanitizeMayhemBundle } from '../../logic/mayhem/bundleSanitize';
import { isDesktop } from '../hooks';

const defaultBundle = sanitizeMayhemBundle(bundled as MayhemBundle);

export function useMayhemBundle(): {
  bundle: MayhemBundle;
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  lastFromNetwork: boolean | null;
} {
  const [bundle, setBundle] = useState<MayhemBundle>(defaultBundle);
  const [loading, setLoading] = useState(isDesktop);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFromNetwork, setLastFromNetwork] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isDesktop || !window.electronAPI?.getMayhemBundle) {
      setLoading(false);
      return;
    }
    void window.electronAPI.getMayhemBundle().then((res) => {
      if (res.success && res.bundle) setBundle(res.bundle as MayhemBundle);
      setLoading(false);
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.refreshMayhemBundle) {
      setRefreshing(true);
      try {
        const res = await fetch('https://arammayhem.com/data/v1/latest/augments.json');
        const augDoc = await res.json();
        const comboRes = await fetch('https://arammayhem.com/data/v1/latest/combos.json');
        const comboDoc = await comboRes.json();
        const { slimMayhemFromApi } = await import('../../logic/mayhem/remote');
        setBundle(slimMayhemFromApi(augDoc, comboDoc));
        setLastFromNetwork(true);
      } catch {
        setLastFromNetwork(false);
      } finally {
        setRefreshing(false);
      }
      return;
    }
    setRefreshing(true);
    try {
      const res = await window.electronAPI.refreshMayhemBundle();
      if (res.success && res.bundle) {
        setBundle(res.bundle as MayhemBundle);
        setLastFromNetwork(!!res.fromNetwork);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { bundle, loading, refreshing, refresh, lastFromNetwork };
}
