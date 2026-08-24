import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Champion } from '../logic/pykeLogic';
import { championSquareUrl } from '../data/ddragonAssets';

interface Props {
    champions: Champion[];
    onSelectionChange: (role: string, champion: Champion | null) => void;
    selections: Record<string, Champion | null>;
    roles?: string[]; // Optional: specify which roles to show
    layout?: 'stack' | 'row';
    compact?: boolean;
}

export const ChampionSelect: React.FC<Props> = ({ champions, onSelectionChange, selections, roles, layout = 'stack', compact = false }) => {
    const displayRoles = roles || ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];
    const gridClass = layout === 'row' && displayRoles.length > 1
      ? displayRoles.length >= 5
        ? 'sm:grid-cols-5'
        : displayRoles.length === 2
          ? 'sm:grid-cols-2'
          : 'sm:grid-cols-3'
      : 'grid-cols-1';
    const [openDropdowns, setOpenDropdowns] = useState<{ [key: string]: boolean }>({});
    const [searchTerms, setSearchTerms] = useState<{ [key: string]: string }>({});
    const [dropdownPositions, setDropdownPositions] = useState<{ [key: string]: { top: number; left: number; width: number } | null }>({});
    const dropdownRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
    // Mirrors openDropdowns for the outside-click listener below, so that
    // listener can stay mounted once instead of re-subscribing on every
    // open/close (and still read fresh state instead of a stale closure).
    const openDropdownsRef = useRef(openDropdowns);
    useEffect(() => {
        openDropdownsRef.current = openDropdowns;
    }, [openDropdowns]);

    const handleSearch = (role: string, value: string) => {
        setSearchTerms(prev => ({ ...prev, [role]: value }));
        setOpenDropdowns(prev => ({ ...prev, [role]: true }));
    };

    // Update dropdown positions when they open
    useEffect(() => {
        Object.keys(openDropdowns).forEach(role => {
            if (openDropdowns[role]) {
                const ref = dropdownRefs.current[role];
                const inputElement = ref?.querySelector('input');
                if (inputElement) {
                    const rect = inputElement.getBoundingClientRect();
                    // position:fixed must use viewport coords (no scroll offsets)
                    const topFixed = rect.bottom + 4;
                    const leftFixed = rect.left;
                    setDropdownPositions(prev => ({
                        ...prev,
                        [role]: {
                            top: topFixed,
                            left: leftFixed,
                            width: rect.width
                        }
                    }));
                }
            } else {
                setDropdownPositions(prev => ({ ...prev, [role]: null }));
            }
        });
    }, [openDropdowns]);

    const selectChampion = (role: string, champion: Champion) => {
        onSelectionChange(role, champion);
        setOpenDropdowns(prev => ({ ...prev, [role]: false }));
        setSearchTerms(prev => ({ ...prev, [role]: '' }));
    };

    const clearSelection = (role: string) => {
        onSelectionChange(role, null);
        setSearchTerms(prev => ({ ...prev, [role]: '' }));
    };

    // Filter champions based on search term
    const getFilteredChampions = (role: string): Champion[] => {
        const searchTerm = searchTerms[role]?.toLowerCase() || '';
        if (!searchTerm) return champions;
        return champions.filter(c => 
            c.name.toLowerCase().includes(searchTerm) ||
            c.id.toLowerCase().includes(searchTerm)
        );
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const current = openDropdownsRef.current;
            const openRoles = Object.keys(current).filter(role => current[role]);
            if (openRoles.length === 0) return;
            openRoles.forEach(role => {
                const ref = dropdownRefs.current[role];
                const target = event.target as Node;
                // Check if click is outside the input/container AND outside any portal dropdown
                if (ref && !ref.contains(target)) {
                    const portalDropdown = document.querySelector('[style*="z-index: 999999"]');
                    if (!portalDropdown || !portalDropdown.contains(target)) {
                        setOpenDropdowns(prev => ({ ...prev, [role]: false }));
                    }
                }
            });
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className={`grid grid-cols-1 ${gridClass} gap-3`} style={{ overflow: 'visible', position: 'relative', zIndex: 200 }}>
            {displayRoles.map((role) => {
                const isOpen = openDropdowns[role] || false;
                const searchTerm = searchTerms[role] || '';
                const selectedChampion = selections[role];
                const filteredChampions = getFilteredChampions(role);

                return (
                    <div key={role} className={`flex flex-col ${compact ? 'gap-0.5' : 'gap-1.5'} relative`} style={{ zIndex: 200 }}>
                        <label className={`uppercase tracking-wide mb-0 ${
                            compact ? 'text-[9px] text-chrome-dim' : 'font-mono tracking-[0.16em] text-[10px]'
                        } ${
                            role === 'YourADC' ? 'text-chrome-dim' : 'text-chrome-silver'
                        }`}>
                            {role === 'YourADC'
                              ? 'Your ADC'
                              : role === 'YourMid'
                                ? 'Your Mid'
                                : role === 'YourJungle'
                                  ? 'Your Jungle'
                                  : role}
                        </label>
                        <div 
                            className="relative" 
                            ref={(el) => { dropdownRefs.current[role] = el; }}
                            style={{ zIndex: 200 }}
                        >
                            {/* Input Field */}
                            <div className="relative">
                                {selectedChampion && (
                                    <img
                                        src={championSquareUrl(selectedChampion.id)}
                                        alt=""
                                        width={22}
                                        height={22}
                                        className="hud-champ-icon absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"
                                        decoding="async"
                                        draggable={false}
                                    />
                                )}
                                <input
                                    type="text"
                                    className={`hud-input w-full pr-8 ${selectedChampion ? 'pl-9' : ''}`}
                                    placeholder={compact ? role : 'Search…'}
                                    value={selectedChampion ? selectedChampion.name : searchTerm}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (selectedChampion && val !== selectedChampion.name) {
                                            clearSelection(role);
                                        }
                                        handleSearch(role, val);
                                    }}
                                    onFocus={() => setOpenDropdowns(prev => ({ ...prev, [role]: true }))}
                                />
                                {selectedChampion && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            clearSelection(role);
                                        }}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-chrome-dim hover:text-chrome-blood transition-colors text-xs font-bold"
                                        title="Clear selection"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>

                            {/* Dropdown List - Using Portal to render at document root */}
                            {isOpen && dropdownPositions[role] && (() => {
                                const pos = dropdownPositions[role];
                                if (!pos) return null;
                                
                                const dropdownContent = (
                                    <div 
                                        className="hud-dropdown fixed max-h-60 overflow-y-auto"
                                        style={{ 
                                            position: 'fixed',
                                            zIndex: 999999,
                                            top: `${pos.top}px`,
                                            left: `${pos.left}px`,
                                            width: `${pos.width}px`,
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {filteredChampions.length === 0 ? (
                                            <div className="p-3 text-sm text-chrome-dim text-center">
                                                No champions found
                                            </div>
                                        ) : (
                                            <div className="py-1">
                                                {filteredChampions.map((champion) => (
                                                    <button
                                                        key={champion.id}
                                                        type="button"
                                                        className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors flex items-center gap-2"
                                                        onClick={() => selectChampion(role, champion)}
                                                    >
                                                        <img
                                                            src={championSquareUrl(champion.id)}
                                                            alt=""
                                                            width={22}
                                                            height={22}
                                                            className="hud-champ-icon shrink-0"
                                                            loading="lazy"
                                                            decoding="async"
                                                            draggable={false}
                                                        />
                                                        <span className="text-chrome-bright text-sm">{champion.name}</span>
                                                        <span className="text-[10px] text-chrome-dim ml-auto font-mono tracking-wider uppercase">
                                                            {champion.tags[0]}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                                
                                return createPortal(dropdownContent, document.body);
                            })()}
                        </div>

                        {/* Selected Champion Info */}
                        {selectedChampion && !compact && (
                            <div className="flex gap-2 mt-0.5">
                                <span className="hud-chip !py-0.5 !text-[8px] text-chrome-dim">
                                    {selectedChampion.damageType}
                                </span>
                                <span className="hud-chip !py-0.5 !text-[8px] text-chrome-dim">
                                    {selectedChampion.tags[0]}
                                </span>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
