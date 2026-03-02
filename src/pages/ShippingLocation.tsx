import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MapPin, Search, Map, AlignLeft, Edit3, X, Save, Navigation, Settings, Check, Package, Clock, Truck, Trash2 } from 'lucide-react';
import { useHeader } from '../context/HeaderContext';
import { CambodiaMap } from '../components/CambodiaMap';
import { supabase } from '../lib/supabase';

interface ShippingRule {
    pcode: string;
    name: string;
    is_shippable: boolean;
    shipping_fee: number;
    estimated_days: string;
    supported_couriers: string[];
}

// Define the data types based on the JSON structure
interface Village {
    code: string;
    khmer: string;
    latin: string;
}

interface Commune {
    code: string;
    khmer: string;
    latin: string;
    villages?: Village[];
}

interface District {
    code: string;
    khmer: string;
    latin: string;
    communes?: Commune[];
}

interface Province {
    code: string;
    khmer: string;
    latin: string;
    districts?: District[];
}

const ShippingLocation: React.FC = () => {
    const { setHeaderContent } = useHeader();

    // States
    const [data, setData] = useState<Province[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState(''); // Village list search
    const [globalSearchTerm, setGlobalSearchTerm] = useState(''); // New global search
    const [isGlobalSearchFocused, setIsGlobalSearchFocused] = useState(false);

    // Refs
    const searchRef = useRef<HTMLDivElement>(null);

    // Selection states
    const [selectedProvinceCode, setSelectedProvinceCode] = useState<string>('');
    const [selectedDistrictCode, setSelectedDistrictCode] = useState<string>('');
    const [selectedCommuneCode, setSelectedCommuneCode] = useState<string>('');
    const [selectedVillageCode, setSelectedVillageCode] = useState<string>('');

    // Mapping states
    const [isEditing, setIsEditing] = useState(false);
    const [editMarkerLatLng, setEditMarkerLatLng] = useState<[number, number] | null>(null);
    const [customLocations, setCustomLocations] = useState<Array<{ pcode: string, lat: number, lng: number }>>([]);
    const [isSavingLocation, setIsSavingLocation] = useState(false);

    // Shipping Rules States
    const [shippingRules, setShippingRules] = useState<ShippingRule[]>([]);
    const [isEditingRule, setIsEditingRule] = useState(false);
    const [isSavingRule, setIsSavingRule] = useState(false);
    const [editRuleData, setEditRuleData] = useState<Partial<ShippingRule>>({});

    // Fetch data dynamically so it doesn't block the main JS bundle
    useEffect(() => {
        setIsLoading(true);
        import('../data/cambodia.json')
            .then((module) => {
                setData(module.default as Province[]);
            })
            .catch((error) => {
                console.error("Failed to load gazetteer data:", error);
            })
            .finally(() => {
                setIsLoading(false);
            });

        loadCustomLocations();
        loadShippingRules();
    }, []);

    const loadCustomLocations = async () => {
        try {
            const { data, error } = await supabase.from('custom_locations').select('pcode, name, lat, lng');
            if (!error && data) {
                setCustomLocations(data);
            }
        } catch (e) {
            console.error("Failed to fetch custom locations", e);
        }
    };

    const loadShippingRules = async () => {
        try {
            const { data, error } = await supabase.from('shipping_rules').select('*');
            if (!error && data) {
                setShippingRules(data);
            }
        } catch (e) {
            console.error("Failed to fetch shipping rules", e);
        }
    };

    // Close search dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setIsGlobalSearchFocused(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MapPin size={20} />
                    <span className="font-semibold text-color-text-main" style={{ fontSize: '18px' }}>ទីតាំងដឹកជញ្ជូន</span>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    // Computed properties based on selection
    const selectedProvince = useMemo(() =>
        data.find(p => p.code === selectedProvinceCode), [data, selectedProvinceCode]
    );

    const activeDistricts = useMemo(() =>
        selectedProvince?.districts || [], [selectedProvince]
    );

    const selectedDistrict = useMemo(() =>
        activeDistricts.find(d => d.code === selectedDistrictCode), [activeDistricts, selectedDistrictCode]
    );

    const activeCommunes = useMemo(() =>
        selectedDistrict?.communes || [], [selectedDistrict]
    );

    const selectedCommune = useMemo(() =>
        activeCommunes.find(c => c.code === selectedCommuneCode), [activeCommunes, selectedCommuneCode]
    );

    const activeVillages = useMemo(() =>
        selectedCommune?.villages || [], [selectedCommune]
    );

    const filteredVillages = useMemo(() => {
        if (!searchQuery) return activeVillages;
        const lowerQuery = searchQuery.toLowerCase();
        return activeVillages.filter(v =>
            v.khmer.includes(lowerQuery) || v.latin.toLowerCase().includes(lowerQuery)
        );
    }, [activeVillages, searchQuery]);

    // Global Search Logic
    const globalSearchResults = useMemo(() => {
        if (!globalSearchTerm || globalSearchTerm.trim().length === 0) return [];

        const term = globalSearchTerm.toLowerCase();
        let results: Array<{
            type: 'province' | 'district' | 'commune' | 'village',
            name: string,
            path: string,
            pcode: string,
            dcode: string,
            ccode: string,
            vcode: string
        }> = [];

        for (const p of data) {
            // Check Province
            if (p.khmer.includes(term) || p.latin.toLowerCase().includes(term)) {
                results.push({ type: 'province', name: p.khmer, path: 'រាជធានី/ខេត្ត', pcode: p.code, dcode: '', ccode: '', vcode: '' });
            }
            if (p.districts) {
                for (const d of p.districts) {
                    // Check District
                    if (d.khmer.includes(term) || d.latin.toLowerCase().includes(term)) {
                        results.push({ type: 'district', name: d.khmer, path: `${p.khmer}`, pcode: p.code, dcode: d.code, ccode: '', vcode: '' });
                    }
                    if (d.communes) {
                        for (const c of d.communes) {
                            // Check Commune
                            if (c.khmer.includes(term) || c.latin.toLowerCase().includes(term)) {
                                results.push({ type: 'commune', name: c.khmer, path: `${p.khmer} > ${d.khmer}`, pcode: p.code, dcode: d.code, ccode: c.code, vcode: '' });
                            }
                            if (c.villages) {
                                for (const v of c.villages) {
                                    // Check Village
                                    if (v.khmer.includes(term) || v.latin.toLowerCase().includes(term)) {
                                        results.push({ type: 'village', name: v.khmer, path: `${p.khmer} > ${d.khmer} > ${c.khmer}`, pcode: p.code, dcode: d.code, ccode: c.code, vcode: v.code });
                                    }
                                    if (results.length > 50) break; // Limit
                                }
                            }
                            if (results.length > 50) break;
                        }
                    }
                    if (results.length > 50) break;
                }
            }
            if (results.length > 50) break;
        }
        return results;
    }, [data, globalSearchTerm]);

    // Active Shipping Rule Logic
    const activeTarget = useMemo(() => {
        if (selectedVillageCode) return { code: selectedVillageCode, type: 'village' as const, name: activeVillages.find(v => v.code === selectedVillageCode)?.khmer };
        if (selectedCommuneCode) return { code: selectedCommuneCode, type: 'commune' as const, name: selectedCommune?.khmer };
        if (selectedDistrictCode) return { code: selectedDistrictCode, type: 'district' as const, name: selectedDistrict?.khmer };
        if (selectedProvinceCode) return { code: selectedProvinceCode, type: 'province' as const, name: selectedProvince?.khmer };
        return null;
    }, [selectedVillageCode, selectedCommuneCode, selectedDistrictCode, selectedProvinceCode, activeVillages, selectedCommune, selectedDistrict, selectedProvince]);

    const activeShippingRule = useMemo(() => {
        if (!selectedProvinceCode) return null;

        const villageRule = shippingRules.find(r => r.pcode === selectedVillageCode);
        if (villageRule) return { rule: villageRule, source: 'village' as const };

        const communeRule = shippingRules.find(r => r.pcode === selectedCommuneCode);
        if (communeRule) return { rule: communeRule, source: 'commune' as const };

        const districtRule = shippingRules.find(r => r.pcode === selectedDistrictCode);
        if (districtRule) return { rule: districtRule, source: 'district' as const };

        const provinceRule = shippingRules.find(r => r.pcode === selectedProvinceCode);
        if (provinceRule) return { rule: provinceRule, source: 'province' as const };

        return null;
    }, [shippingRules, selectedProvinceCode, selectedDistrictCode, selectedCommuneCode, selectedVillageCode]);

    // Handlers
    const handleProvinceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedProvinceCode(e.target.value);
        setSelectedDistrictCode('');
        setSelectedCommuneCode('');
        setSelectedVillageCode('');
        setEditMarkerLatLng(null);
    };

    const handleDistrictChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedDistrictCode(e.target.value);
        setSelectedCommuneCode('');
        setSelectedVillageCode('');
        setEditMarkerLatLng(null);
    };

    const handleCommuneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedCommuneCode(e.target.value);
        setSelectedVillageCode('');
        setEditMarkerLatLng(null);
    };

    const handleVillageClick = (code: string) => {
        setSelectedVillageCode(code === selectedVillageCode ? '' : code);
        setEditMarkerLatLng(null);
    };

    const handleSelectSearchResult = (pcode: string, dcode: string, ccode: string, vcode: string) => {
        if (pcode) setSelectedProvinceCode(pcode); else setSelectedProvinceCode('');
        if (dcode) setSelectedDistrictCode(dcode); else setSelectedDistrictCode('');
        if (ccode) setSelectedCommuneCode(ccode); else setSelectedCommuneCode('');
        if (vcode) setSelectedVillageCode(vcode); else setSelectedVillageCode('');
        setEditMarkerLatLng(null);
        setGlobalSearchTerm('');
        setIsGlobalSearchFocused(false);
    };

    const handleAreaSelect = (type: 'province' | 'district' | 'commune' | 'village', code: string) => {
        // Find the matched item across our data hierarchy
        for (const p of data) {
            if (type === 'province' && p.code === code) {
                handleSelectSearchResult(p.code, '', '', '');
                return;
            }
            if (p.districts) {
                for (const d of p.districts) {
                    if (type === 'district' && d.code === code) {
                        handleSelectSearchResult(p.code, d.code, '', '');
                        return;
                    }
                    if (d.communes) {
                        for (const c of d.communes) {
                            if (type === 'commune' && c.code === code) {
                                handleSelectSearchResult(p.code, d.code, c.code, '');
                                return;
                            }
                            if (c.villages) {
                                for (const v of c.villages) {
                                    if (type === 'village' && v.code === code) {
                                        handleSelectSearchResult(p.code, d.code, c.code, v.code);
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    };

    const handleSaveLocation = async () => {
        if (!editMarkerLatLng) return;

        // Determine what target the user is currently focused on
        let targetPcode = '';
        let targetName = '';
        let targetType = '';

        if (selectedVillageCode) {
            const v = activeVillages.find(v => v.code === selectedVillageCode);
            targetPcode = selectedVillageCode;
            targetName = v?.khmer || selectedVillageCode;
            targetType = 'village';
        } else if (selectedCommuneCode) {
            targetPcode = selectedCommuneCode;
            targetName = selectedCommune?.khmer || selectedCommuneCode;
            targetType = 'commune';
        } else if (selectedDistrictCode) {
            targetPcode = selectedDistrictCode;
            targetName = selectedDistrict?.khmer || selectedDistrictCode;
            targetType = 'district';
        } else if (selectedProvinceCode) {
            targetPcode = selectedProvinceCode;
            targetName = selectedProvince?.khmer || selectedProvinceCode;
            targetType = 'province';
        }

        if (!targetPcode) {
            alert('Please select a province, district, commune, or village first.');
            return;
        }

        setIsSavingLocation(true);
        try {
            // Upsert location based on pcode
            const { error } = await supabase.from('custom_locations').upsert({
                pcode: targetPcode,
                name: targetName,
                lat: editMarkerLatLng[0],
                lng: editMarkerLatLng[1],
                type: targetType,
                updated_at: new Date().toISOString()
            }, { onConflict: 'pcode' });

            if (error) throw error;
            setIsEditing(false);
            setEditMarkerLatLng(null);
            await loadCustomLocations();
            alert(`Location specifically mapped to ${targetName}!`);
        } catch (e: any) {
            alert('Error saving location: ' + e.message);
        } finally {
            setIsSavingLocation(false);
        }
    };

    const handleRemoveLocation = async () => {
        // Determine what target the user is currently focused on
        let targetPcode = '';
        let targetName = '';

        if (selectedVillageCode) {
            targetPcode = selectedVillageCode;
            targetName = activeVillages.find(v => v.code === selectedVillageCode)?.khmer || selectedVillageCode;
        } else if (selectedCommuneCode) {
            targetPcode = selectedCommuneCode;
            targetName = selectedCommune?.khmer || selectedCommuneCode;
        } else if (selectedDistrictCode) {
            targetPcode = selectedDistrictCode;
            targetName = selectedDistrict?.khmer || selectedDistrictCode;
        } else if (selectedProvinceCode) {
            targetPcode = selectedProvinceCode;
            targetName = selectedProvince?.khmer || selectedProvinceCode;
        }

        if (!targetPcode) {
            alert('Please select a province, district, commune, or village first.');
            return;
        }

        const confirmRemove = window.confirm(`តើអ្នកពិតជាចង់លុបទីតាំង "${targetName}" នេះមែនទេ? (Are you sure you want to remove the pin for ${targetName}?)`);
        if (!confirmRemove) return;

        setIsSavingLocation(true);
        try {
            const { error } = await supabase.from('custom_locations').delete().eq('pcode', targetPcode);
            if (error) throw error;

            setEditMarkerLatLng(null);
            await loadCustomLocations();
            alert(`Location pin removed for ${targetName}!`);
        } catch (e: any) {
            alert('Error removing location pin: ' + e.message);
        } finally {
            setIsSavingLocation(false);
        }
    };

    const handleSaveShippingRule = async () => {
        if (!activeTarget) return;

        setIsSavingRule(true);
        try {
            const ruleData = {
                pcode: activeTarget.code,
                name: activeTarget.name || activeTarget.code,
                is_shippable: editRuleData.is_shippable ?? true,
                shipping_fee: editRuleData.shipping_fee ?? 1.50,
                estimated_days: editRuleData.estimated_days || '1-2 days',
                supported_couriers: editRuleData.supported_couriers || [],
                updated_at: new Date().toISOString()
            };

            const { error } = await supabase.from('shipping_rules').upsert(ruleData, { onConflict: 'pcode' });
            if (error) throw error;

            setIsEditingRule(false);
            await loadShippingRules();
        } catch (e: any) {
            alert('Error saving shipping rule: ' + e.message);
        } finally {
            setIsSavingRule(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header Description */}
            <div style={{ padding: '24px 24px 16px', flexShrink: 0 }}>
                <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '8px' }}>ភូមិសាស្ត្រកម្ពុជាពីទិន្នន័យក្នុងប្រព័ន្ធ</h1>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '15px', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Map size={18} />
                    ជ្រើសរើស ទីតាំងតាមឋានានុក្រម (ខេត្ត, ស្រុក, ឃុំ, ភូមិ)
                </p>
            </div>

            <div style={{
                flex: 1,
                padding: '0 24px 24px',
                display: 'grid',
                gridTemplateColumns: 'minmax(350px, 1fr) 1fr',
                gap: '24px'
            }}>

                {/* Left Panel: Filters & List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {/* Filters Section */}
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px',
                        background: 'var(--color-surface)',
                        padding: '24px',
                        borderRadius: '16px',
                        border: '1px solid var(--color-border)',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.02)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '-4px' }}>
                            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-main)' }}>ជ្រើសរើសទីតាំង</div>
                            {(selectedProvinceCode || selectedDistrictCode || selectedCommuneCode || selectedVillageCode) && (
                                <button
                                    onClick={() => handleSelectSearchResult('', '', '', '')}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '4px 10px',
                                        borderRadius: '6px',
                                        border: '1px solid transparent',
                                        background: 'var(--color-bg-secondary)',
                                        color: 'var(--color-text-secondary)',
                                        fontSize: '13px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseOver={e => {
                                        e.currentTarget.style.color = 'var(--color-error)';
                                        e.currentTarget.style.background = '#fee2e2'; // light red
                                    }}
                                    onMouseOut={e => {
                                        e.currentTarget.style.color = 'var(--color-text-secondary)';
                                        e.currentTarget.style.background = 'var(--color-bg-secondary)';
                                    }}
                                >
                                    <X size={14} /> បោះបង់ (Clear)
                                </button>
                            )}
                        </div>

                        {/* Global Search */}
                        <div ref={searchRef} style={{ position: 'relative', marginBottom: '8px' }}>
                            <div style={{ position: 'relative' }}>
                                <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                                <input
                                    type="text"
                                    placeholder="ស្វែងរកទីតាំងរហ័ស (ខេត្ត, ស្រុក, ឃុំ, ភូមិ)..."
                                    value={globalSearchTerm}
                                    onChange={e => setGlobalSearchTerm(e.target.value)}
                                    onFocus={() => setIsGlobalSearchFocused(true)}
                                    style={{
                                        width: '100%',
                                        padding: '12px 16px 12px 42px',
                                        borderRadius: '10px',
                                        border: '1px solid var(--color-primary)',
                                        background: 'var(--color-primary-light)',
                                        color: 'var(--color-text-main)',
                                        fontSize: '15px',
                                        outline: 'none',
                                        boxShadow: '0 2px 8px rgba(var(--color-primary-rgb), 0.1)'
                                    }}
                                />
                                {globalSearchTerm && (
                                    <button
                                        onClick={() => setGlobalSearchTerm('')}
                                        style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex' }}
                                    >
                                        <X size={16} />
                                    </button>
                                )}
                            </div>

                            {/* Dropdown Results */}
                            {isGlobalSearchFocused && globalSearchTerm && (
                                <div style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    right: 0,
                                    marginTop: '8px',
                                    background: 'var(--color-surface)',
                                    borderRadius: '12px',
                                    border: '1px solid var(--color-border)',
                                    boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
                                    zIndex: 50,
                                    maxHeight: '400px',
                                    overflowY: 'auto',
                                    overflowX: 'hidden'
                                }}>
                                    {globalSearchResults.length === 0 ? (
                                        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                            គ្មានលទ្ធផលសម្រាប់ "{globalSearchTerm}"
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            {globalSearchResults.map((res, idx) => (
                                                <div
                                                    key={`${res.pcode}-${res.dcode}-${res.ccode}-${res.vcode}-${idx}`}
                                                    onClick={() => handleSelectSearchResult(res.pcode, res.dcode, res.ccode, res.vcode)}
                                                    style={{
                                                        padding: '12px 16px',
                                                        borderBottom: '1px solid var(--color-border)',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '12px',
                                                        transition: 'background 0.2s'
                                                    }}
                                                    onMouseOver={e => e.currentTarget.style.background = 'var(--color-bg-secondary)'}
                                                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                                                >
                                                    <div style={{
                                                        background: 'var(--color-primary-light)',
                                                        color: 'var(--color-primary)',
                                                        padding: '8px',
                                                        borderRadius: '8px',
                                                        display: 'flex'
                                                    }}>
                                                        <Navigation size={18} />
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: 600, color: 'var(--color-text-main)', fontSize: '15px' }}>
                                                            {res.name} <span style={{ fontSize: '12px', color: 'var(--color-primary)', fontWeight: 500, marginLeft: '6px' }}>({res.type})</span>
                                                        </div>
                                                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                                                            {res.path}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <hr style={{ border: 0, borderTop: '1px solid var(--color-border)', margin: '4px 0 8px' }} />

                        {/* Province Select */}
                        <div>
                            <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>រាជធានី / ខេត្ត</label>
                            <select
                                value={selectedProvinceCode}
                                onChange={handleProvinceChange}
                                disabled={isLoading}
                                style={{
                                    width: '100%',
                                    padding: '10px 14px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)',
                                    background: 'var(--color-bg)',
                                    color: 'var(--color-text-main)',
                                    fontSize: '14px',
                                    outline: 'none'
                                }}
                            >
                                <option value="">-- បង្ហាញរាជធានី និងខេត្ត --</option>
                                {data.map(province => (
                                    <option key={province.code} value={province.code}>
                                        {province.khmer} ({province.latin})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* District Select */}
                        <div>
                            <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>ក្រុង / ស្រុក / ខណ្ឌ</label>
                            <select
                                value={selectedDistrictCode}
                                onChange={handleDistrictChange}
                                disabled={!selectedProvinceCode}
                                style={{
                                    width: '100%',
                                    padding: '10px 14px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)',
                                    background: !selectedProvinceCode ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
                                    color: 'var(--color-text-main)',
                                    fontSize: '14px',
                                    outline: 'none',
                                    opacity: !selectedProvinceCode ? 0.6 : 1
                                }}
                            >
                                <option value="">-- ជ្រើសរើសស្រុក --</option>
                                {activeDistricts.map(district => (
                                    <option key={district.code} value={district.code}>
                                        {district.khmer} ({district.latin})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Commune Select */}
                        <div>
                            <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>ឃុំ / សង្កាត់</label>
                            <select
                                value={selectedCommuneCode}
                                onChange={handleCommuneChange}
                                disabled={!selectedDistrictCode}
                                style={{
                                    width: '100%',
                                    padding: '10px 14px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)',
                                    background: !selectedDistrictCode ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
                                    color: 'var(--color-text-main)',
                                    fontSize: '14px',
                                    outline: 'none',
                                    opacity: !selectedDistrictCode ? 0.6 : 1
                                }}
                            >
                                <option value="">-- ជ្រើសរើសឃុំ --</option>
                                {activeCommunes.map(commune => (
                                    <option key={commune.code} value={commune.code}>
                                        {commune.khmer} ({commune.latin})
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Shipping Rules Section */}
                    {activeTarget && (
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            background: 'var(--color-surface)',
                            padding: '24px',
                            borderRadius: '16px',
                            border: '1px solid var(--color-border)',
                            boxShadow: '0 2px 10px rgba(0,0,0,0.02)'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Truck size={18} color="var(--color-primary)" />
                                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--color-text-main)' }}>ព័ត៌មានដឹកជញ្ជូន</h3>
                                </div>
                                {!isEditingRule && (
                                    <button
                                        onClick={() => {
                                            setEditRuleData(activeShippingRule?.rule || {
                                                is_shippable: true,
                                                shipping_fee: 1.50,
                                                estimated_days: '1-2 days',
                                                supported_couriers: []
                                            });
                                            setIsEditingRule(true);
                                        }}
                                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: 'var(--color-primary-light)', border: 'none', borderRadius: '6px', color: 'var(--color-primary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                                    >
                                        <Settings size={14} /> កំណត់រចនាសម្ព័ន្ធ (Configure)
                                    </button>
                                )}
                            </div>

                            {activeShippingRule && !isEditingRule && (
                                <div style={{ background: 'var(--color-bg)', padding: '16px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                    <div style={{ marginBottom: '12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary)', padding: '4px 8px', borderRadius: '4px' }}>
                                            Applied rule from: <span style={{ fontWeight: 600, color: 'var(--color-primary)', textTransform: 'capitalize' }}>{activeShippingRule.source}</span>
                                        </span>

                                        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary)', padding: '4px 8px', borderRadius: '4px' }}>
                                            Admin Code: <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{activeTarget.code}</span>
                                        </span>

                                        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary)', padding: '4px 8px', borderRadius: '4px' }}>
                                            Postal Code: <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
                                                {activeTarget.type === 'village' ? activeTarget.code.substring(0, 6) : activeTarget.type === 'commune' ? activeTarget.code : activeTarget.type === 'district' ? activeTarget.code.padEnd(6, '0') : activeTarget.code.padEnd(6, '0')}
                                            </span>
                                        </span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                        <div>
                                            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>ស្ថានភាព (Status)</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: activeShippingRule.rule.is_shippable ? '#10b981' : '#ef4444', fontWeight: 600, fontSize: '14px' }}>
                                                {activeShippingRule.rule.is_shippable ? <Check size={16} /> : <X size={16} />}
                                                {activeShippingRule.rule.is_shippable ? 'អាចដឹកជញ្ជូនបាន' : 'មិនអាចដឹកជញ្ជូនបាន'}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>តម្លៃសេវា (Fee)</div>
                                            <div style={{ color: 'var(--color-text-main)', fontWeight: 600, fontSize: '14px' }}>
                                                ${activeShippingRule.rule.shipping_fee.toFixed(2)}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>ការប៉ាន់ស្មាន (ETA)</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-main)', fontWeight: 600, fontSize: '14px' }}>
                                                <Clock size={14} color="var(--color-text-secondary)" /> {activeShippingRule.rule.estimated_days}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>ក្រុមហ៊ុនដឹក (Couriers)</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-main)', fontWeight: 600, fontSize: '14px' }}>
                                                <Package size={14} color="var(--color-text-secondary)" /> {activeShippingRule.rule.supported_couriers?.join(', ') || 'Any'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {!activeShippingRule && !isEditingRule && (
                                <div style={{ textAlign: 'center', padding: '16px', color: 'var(--color-text-secondary)', fontSize: '14px', background: 'var(--color-bg)', borderRadius: '8px', border: '1px dashed var(--color-border)' }}>
                                    <div style={{ marginBottom: '12px' }}>
                                        ពុំមានច្បាប់ដឹកជញ្ជូនដែលបានកំណត់នៅឡើយទេ។ (No rules applied. Using global defaults.)
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary)', padding: '4px 8px', borderRadius: '4px' }}>
                                            Admin Code: <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{activeTarget.code}</span>
                                        </span>

                                        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary)', padding: '4px 8px', borderRadius: '4px' }}>
                                            Postal Code: <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
                                                {activeTarget.type === 'village' ? activeTarget.code.substring(0, 6) : activeTarget.type === 'commune' ? activeTarget.code : activeTarget.type === 'district' ? activeTarget.code.padEnd(6, '0') : activeTarget.code.padEnd(6, '0')}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            )}

                            {isEditingRule && (
                                <div style={{ background: 'var(--color-bg)', padding: '16px', borderRadius: '8px', border: '1px solid var(--color-primary)' }}>
                                    <div style={{ fontSize: '13px', color: 'var(--color-primary)', fontWeight: 500, marginBottom: '16px' }}>
                                        Setting rule for exact override on: {activeTarget.name} ({activeTarget.type})
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>អាចដឹកជញ្ជូនបាន (Shippable)</label>
                                            <select
                                                value={editRuleData.is_shippable ? 'yes' : 'no'}
                                                onChange={e => {
                                                    const isShippable = e.target.value === 'yes';
                                                    setEditRuleData({ ...editRuleData, is_shippable: isShippable });
                                                    // If turning ON shippable, auto-enable edit map mode to guide them
                                                    if (isShippable) setIsEditing(true);
                                                }}
                                                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '14px', outline: 'none' }}
                                            >
                                                <option value="yes">Yes (អាចដឹកបាន)</option>
                                                <option value="no">No (មិនអាចដឹកបាន)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>តម្លៃសេវា (Fee $)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={editRuleData.shipping_fee || ''}
                                                onChange={e => setEditRuleData({ ...editRuleData, shipping_fee: parseFloat(e.target.value) || 0 })}
                                                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '14px', outline: 'none' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>រយៈពេល (ETA)</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. 1-2 days"
                                                value={editRuleData.estimated_days || ''}
                                                onChange={e => setEditRuleData({ ...editRuleData, estimated_days: e.target.value })}
                                                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '14px', outline: 'none' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>ក្រុមហ៊ុន (Couriers, comma-separated)</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. J&T, VET"
                                                value={editRuleData.supported_couriers?.join(', ') || ''}
                                                onChange={e => setEditRuleData({ ...editRuleData, supported_couriers: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                                                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '14px', outline: 'none' }}
                                            />
                                        </div>
                                    </div>

                                    {editRuleData.is_shippable && !customLocations.some(l => l.pcode === activeTarget.code) && (
                                        <div style={{ padding: '12px', background: 'var(--color-warning-light, #fef3c7)', border: '1px solid var(--color-warning, #f59e0b)', borderRadius: '8px', color: '#b45309', fontSize: '13px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <MapPin size={16} style={{ flexShrink: 0 }} />
                                            <span>
                                                សូមចុចលើផែនទីដើម្បីកំណត់ទីតាំងភូមិសាស្ត្រជាមុនសិន។ /
                                                <b> Please drop a pin on the map first to save a Shippable location.</b>
                                            </span>
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                        <button
                                            onClick={() => { setIsEditingRule(false); setIsEditing(false); }}
                                            style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: '6px', color: 'var(--color-text-secondary)', fontSize: '14px', cursor: 'pointer' }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSaveShippingRule}
                                            disabled={isSavingRule || (editRuleData.is_shippable && !customLocations.some(l => l.pcode === activeTarget.code))}
                                            style={{
                                                padding: '8px 16px',
                                                background: 'var(--color-primary)',
                                                border: 'none',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '14px',
                                                cursor: (isSavingRule || (editRuleData.is_shippable && !customLocations.some(l => l.pcode === activeTarget.code))) ? 'not-allowed' : 'pointer',
                                                fontWeight: 500,
                                                opacity: (isSavingRule || (editRuleData.is_shippable && !customLocations.some(l => l.pcode === activeTarget.code))) ? 0.5 : 1
                                            }}
                                        >
                                            {isSavingRule ? 'Saving...' : 'Save Rule'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Content Section */}
                    <div style={{
                        flex: 1,
                        background: 'var(--color-surface)',
                        borderRadius: '16px',
                        border: '1px solid var(--color-border)',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden'
                    }}>

                        {isLoading ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px' }}>
                                <div className="loader" style={{ width: '40px', height: '40px', border: '3px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                            </div>
                        ) : !selectedProvinceCode ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px', color: 'var(--color-text-secondary)' }}>
                                <MapPin size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                                <p style={{ fontSize: '16px' }}>សូមជ្រើសរើសរាជធានី ឬ ខេត្តខាងលើ</p>
                            </div>
                        ) : !selectedDistrictCode ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px', color: 'var(--color-text-secondary)' }}>
                                <AlignLeft size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                                <p style={{ fontSize: '16px' }}>សូមជ្រើសរើសក្រុង ស្រុក ឬខណ្ឌ</p>
                            </div>
                        ) : !selectedCommuneCode ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px', color: 'var(--color-text-secondary)' }}>
                                <AlignLeft size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                                <p style={{ fontSize: '16px' }}>សូមជ្រើសរើសឃុំ ឬសង្កាត់</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                <div style={{ padding: '20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--color-text-main)' }}>បញ្ជីភូមិ</h3>
                                        <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                            សរុបមាន {activeVillages.length} ភូមិអនឡាញ
                                        </p>
                                    </div>
                                    <div style={{ position: 'relative', width: '250px' }}>
                                        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                                        <input
                                            type="text"
                                            placeholder="ស្វែងរកភូមិ..."
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '8px 12px 8px 36px',
                                                borderRadius: '20px',
                                                border: '1px solid var(--color-border)',
                                                background: 'var(--color-bg)',
                                                fontSize: '14px',
                                                outline: 'none'
                                            }}
                                        />
                                    </div>
                                </div>

                                <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                                    {filteredVillages.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-secondary)' }}>
                                            រកមិនឃើញភូមិឈ្មោះ "{searchQuery}" ទេ
                                        </div>
                                    ) : (
                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                            gap: '12px'
                                        }}>
                                            {filteredVillages.map((village, idx) => {
                                                const isSelected = village.code === selectedVillageCode;
                                                return (
                                                    <div
                                                        key={village.code}
                                                        onClick={() => handleVillageClick(village.code)}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            padding: '16px',
                                                            background: isSelected ? 'var(--color-primary-light)' : 'var(--color-bg)',
                                                            borderRadius: '12px',
                                                            border: `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                                            gap: '16px',
                                                            cursor: 'pointer',
                                                            transition: 'all 0.2s'
                                                        }}>
                                                        <div style={{
                                                            width: '32px',
                                                            height: '32px',
                                                            borderRadius: '8px',
                                                            background: isSelected ? 'var(--color-primary)' : 'var(--color-primary-light)',
                                                            color: isSelected ? '#fff' : 'var(--color-primary)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            fontWeight: 600,
                                                            fontSize: '14px'
                                                        }}>
                                                            {idx + 1}
                                                        </div>
                                                        <div>
                                                            <div style={{ fontWeight: 600, color: isSelected ? 'var(--color-primary)' : 'var(--color-text-main)', fontSize: '15px', marginBottom: '4px' }}>
                                                                {village.khmer}
                                                            </div>
                                                            <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                                                {village.latin} • {village.code}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel: Interactive Map */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--color-surface)',
                    borderRadius: '16px',
                    border: '1px solid var(--color-border)',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                    overflow: 'hidden',
                    position: 'relative',
                    minHeight: '400px',
                    height: '100%'
                }}>

                    {/* Floating Controls */}
                    <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, display: 'flex', gap: '8px' }}>
                        {isEditing ? (
                            <div style={{ display: 'flex', background: 'var(--color-surface)', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                                <button
                                    onClick={() => { setIsEditing(false); setEditMarkerLatLng(null); }}
                                    style={{ padding: '8px 16px', background: 'none', border: 'none', borderRight: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                                >
                                    <X size={16} /> បោះបង់
                                </button>
                                <button
                                    onClick={handleSaveLocation}
                                    disabled={!editMarkerLatLng || isSavingLocation}
                                    style={{ padding: '8px 16px', background: 'var(--color-primary)', border: 'none', color: '#fff', fontWeight: 500, cursor: (!editMarkerLatLng || isSavingLocation) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: (!editMarkerLatLng || isSavingLocation) ? 0.7 : 1 }}
                                >
                                    <Save size={16} /> រក្សាទុក
                                </button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', gap: '8px' }}>
                                {customLocations.some(l => l.pcode === activeTarget?.code) && (
                                    <button
                                        onClick={handleRemoveLocation}
                                        disabled={isSavingLocation}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '8px',
                                            padding: '8px 16px',
                                            background: 'var(--color-surface)',
                                            border: '1px solid var(--color-danger, #ef4444)',
                                            borderRadius: '8px',
                                            color: 'var(--color-danger, #ef4444)',
                                            fontWeight: 500,
                                            cursor: isSavingLocation ? 'not-allowed' : 'pointer',
                                            boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
                                        }}
                                    >
                                        <Trash2 size={16} /> លុបទីតាំង
                                    </button>
                                )}
                                <button
                                    onClick={() => setIsEditing(true)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '8px 16px',
                                        background: 'var(--color-surface)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '8px',
                                        color: 'var(--color-text-main)',
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
                                    }}
                                >
                                    <Edit3 size={16} /> Edit Map
                                </button>
                            </div>
                        )}
                    </div>
                    {isEditing && (
                        <div style={{ position: 'absolute', top: 16, left: 16, right: 'auto', zIndex: 10, background: 'var(--color-primary-light)', color: 'var(--color-primary)', padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--color-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <MapPin size={18} /> ជាដំបូងសូមជ្រើសរើសទីតាំង រួចចុចលើផែនទីដើម្បីកំណត់ចំណុច (Click map to drop pin)
                        </div>
                    )}


                    <CambodiaMap
                        selectedProvinceCode={selectedProvinceCode}
                        selectedDistrictCode={selectedDistrictCode}
                        selectedCommuneCode={selectedCommuneCode}
                        selectedVillageCode={selectedVillageCode}
                        isEditing={isEditing}
                        editMarkerLatLng={editMarkerLatLng}
                        onMapClick={(lat, lng) => setEditMarkerLatLng([lat, lng])}
                        onAreaSelect={handleAreaSelect}
                        customLocations={customLocations}
                        shippingRules={shippingRules}
                    />
                </div>

                {/* Grid container closes here */}
            </div>

            <style>{`
                @keyframes spin { 100% { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

export default ShippingLocation;
