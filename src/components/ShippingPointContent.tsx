import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MapPin, Search, Map, X, Trash2, Navigation, ChevronUp, ChevronDown, Save, Copy, Edit2, Power, AlertTriangle } from 'lucide-react';
import { useHeader } from '../context/HeaderContext';
import { useToast } from '../context/ToastContext';
import { CambodiaMap } from '../components/CambodiaMap';
import { supabase } from '../lib/supabase';
import { getShippingCoColor } from '../utils/orderUtils';



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

interface ShippingPointContentProps {
    mode?: 'page' | 'selector';
    onClose?: () => void;
    onSelect?: (data: {
        province: string;
        provinceLatin?: string;
        district?: string;
        commune?: string;
        village?: string;
        addressDetail: string;
        customName: string;
        courier: string;
        phone: string;
        contactName: string;
    }) => void;
    tableName?: string;
    pageTitle?: string;
    pageSubtitle?: string;
    headerTitle?: string;
    mapSource?: 'google' | 'osm';
    hideHeaderEffect?: boolean;
    hideHeader?: boolean;
}

export const ShippingPointContent: React.FC<ShippingPointContentProps> = ({ 
    mode = 'page', 
    onClose, 
    onSelect, 
    tableName = 'custom_locations', 
    pageTitle, 
    pageSubtitle, 
    headerTitle, 
    mapSource = 'google',
    hideHeaderEffect = false,
    hideHeader = false
}) => {
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();

    // States
    const [data, setData] = useState<Province[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [globalSearchTerm, setGlobalSearchTerm] = useState(''); // New global search
    const [isGlobalSearchFocused, setIsGlobalSearchFocused] = useState(false);
    const [searchPinnedTerm, setSearchPinnedTerm] = useState(''); // New search for pinned locations

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
    const [focusedPinLatLng, setFocusedPinLatLng] = useState<[number, number] | null>(null);
    const [customLocations, setCustomLocations] = useState<Array<{
        id: string,
        pcode: string,
        name: string,
        lat: number,
        lng: number,
        courier?: string | null,
        province?: string | null,
        district?: string | null,
        commune?: string | null,
        phone?: string | null,
        contact_name?: string | null,
        is_shutdown?: boolean
    }>>([]);
    const [isSavingLocation, setIsSavingLocation] = useState(false);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const [isPinnedListExpanded, setIsPinnedListExpanded] = useState(false);
    const [isLocationSelectorsExpanded, setIsLocationSelectorsExpanded] = useState(true);

    // Modal states
    const [shippingCompanies, setShippingCompanies] = useState<string[]>([]);
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
    const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
    const [savingError, setSavingError] = useState<string | null>(null);
    const [modalData, setModalData] = useState({
        name: '',
        courier: '',
        province: '',
        district: '',
        commune: '',
        phone: '',
        contactName: '',
        isShutdown: false
    });
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
        loadShippingCompanies();
    }, []);

    const loadShippingCompanies = async () => {
        try {
            const { data, error } = await supabase.from('app_config').select('data').eq('id', 1).single();
            if (!error && data?.data?.shippingCompanies) {
                setShippingCompanies(data.data.shippingCompanies);
            }
        } catch (e) {
            console.error("Failed to load shipping companies", e);
        }
    };

    const loadCustomLocations = async () => {
        try {
            const { data, error } = await supabase.from(tableName).select('*');
            if (!error && data) {
                setCustomLocations(data);
            }
        } catch (e) {
            console.error("Failed to fetch custom locations", e);
        }
    };


    const [activeCustomLocation, setActiveCustomLocation] = useState<typeof customLocations[0] | null>(null);

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
        if (mode === 'page' && !hideHeaderEffect) {
            setHeaderContent({
                title: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <MapPin size={20} />
                        <span className="font-semibold text-color-text-main" style={{ fontSize: '18px' }}>{headerTitle || 'កំណត់ទីតាំងដឹកជញ្ជូនកនែ្លងផ្សេងៗ (Shipping Points)'}</span>
                    </div>
                )
            });
            return () => setHeaderContent(null);
        }
    }, [setHeaderContent, mode, headerTitle, hideHeaderEffect]);

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

    // Group Pinned Locations by Province
    const pinnedLocationsByProvince = useMemo(() => {
        const groups: Record<string, { provinceName: string, provinceCode: string, locations: typeof customLocations }> = {};

        // Helper to find province details
        const getProvinceInfo = (loc: typeof customLocations[0]) => {
            // If the pin explicitly saved a province name, try to map it back to a code
            if (loc.province) {
                const province = data.find(p => p.khmer === loc.province || p.latin === loc.province);
                if (province) return { name: province.khmer, code: province.code };
                return { name: loc.province, code: '' }; // Fallback to raw string if code not found
            }

            // Fallback to legacy parsing for non-custom administrative targets
            const provinceCode = loc.pcode.substring(0, 2);
            const province = data.find(p => p.code === provinceCode);
            return province ? { name: province.khmer, code: province.code } : { name: 'Unknown', code: '' };
        };

        // Helper to find location codes (province, district, commune)
        const getLocationCodes = (loc: typeof customLocations[0]) => {
            let pCode = '';
            let dCode = '';
            let cCode = '';

            if (loc.pcode && !loc.pcode.startsWith('CUSTOM_')) {
                pCode = loc.pcode.substring(0, 2);
                if (loc.pcode.length >= 4) dCode = loc.pcode.substring(0, 4);
                if (loc.pcode.length >= 6) cCode = loc.pcode.substring(0, 6);
            } else {
                // Custom locations map by name matching from data structure
                if (loc.province) {
                    const province = data.find(p => p.khmer === loc.province || p.latin === loc.province);
                    if (province) {
                        pCode = province.code;
                        if (loc.district && province.districts) {
                            const district = province.districts.find(d => d.khmer === loc.district || d.latin === loc.district);
                            if (district) {
                                dCode = district.code;
                                if (loc.commune && district.communes) {
                                    const commune = district.communes.find(c => c.khmer === loc.commune || c.latin === loc.commune);
                                    if (commune) {
                                        cCode = commune.code;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            return { provinceCode: pCode, districtCode: dCode, communeCode: cCode };
        };

        let filteredLocations = searchPinnedTerm.trim() === ''
            ? customLocations
            : customLocations.filter(loc => {
                const { name: provinceName } = getProvinceInfo(loc);
                const searchTerm = searchPinnedTerm.toLowerCase();
                return loc.name.toLowerCase().includes(searchTerm) || provinceName.toLowerCase().includes(searchTerm);
            });

        // Filter by selected area if chosen
        if (selectedProvinceCode) {
            filteredLocations = filteredLocations.filter(loc => {
                const codes = getLocationCodes(loc);
                if (codes.provinceCode !== selectedProvinceCode) return false;
                if (selectedDistrictCode && codes.districtCode !== selectedDistrictCode) return false;
                if (selectedCommuneCode && codes.communeCode !== selectedCommuneCode) return false;
                return true;
            });
        }

        filteredLocations.forEach(loc => {
            const { name: provinceName, code: provinceCode } = getProvinceInfo(loc);
            const key = provinceName;

            if (!groups[key]) {
                groups[key] = { provinceName, provinceCode, locations: [] };
            }
            groups[key].locations.push(loc);
        });

        // Sort keys alphabetically
        return Object.keys(groups).sort().map(key => groups[key]);
    }, [customLocations, data, searchPinnedTerm, selectedProvinceCode, selectedDistrictCode, selectedCommuneCode]);




    const handleProvinceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        setSelectedProvinceCode(val);
        setSelectedDistrictCode('');
        setSelectedCommuneCode('');
        setSelectedVillageCode('');
        setEditMarkerLatLng(null);
        setActiveCustomLocation(null);
        if (val) {
            setIsPinnedListExpanded(true);
        }
    };

    const handleDistrictChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        setSelectedDistrictCode(val);
        setSelectedCommuneCode('');
        setSelectedVillageCode('');
        setEditMarkerLatLng(null);
        setActiveCustomLocation(null);
        if (val) {
            setIsPinnedListExpanded(true);
        }
    };

    const handleCommuneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        setSelectedCommuneCode(val);
        setSelectedVillageCode('');
        setEditMarkerLatLng(null);
        setActiveCustomLocation(null);
        if (val) {
            setIsPinnedListExpanded(true);
        }
    };

    const handleVillageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        setSelectedVillageCode(val);
        setEditMarkerLatLng(null);
        setActiveCustomLocation(null);
        if (val) {
            setIsPinnedListExpanded(true);
        }
    };

    const handleSelectSearchResult = (pcode: string, dcode: string, ccode: string, vcode: string) => {
        if (pcode) setSelectedProvinceCode(pcode); else setSelectedProvinceCode('');
        if (dcode) setSelectedDistrictCode(dcode); else setSelectedDistrictCode('');
        if (ccode) setSelectedCommuneCode(ccode); else setSelectedCommuneCode('');
        if (vcode) setSelectedVillageCode(vcode); else setSelectedVillageCode('');
        setEditMarkerLatLng(null);
        setGlobalSearchTerm('');
        setIsGlobalSearchFocused(false);
        setActiveCustomLocation(null);
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

    const handleMapClick = async (lat: number, lng: number) => {
        setIsEditing(true);
        setEditMarkerLatLng([lat, lng]);
    };

    const handleMarkerClick = (loc: typeof customLocations[0]) => {
        setIsPinnedListExpanded(true);
        setSearchPinnedTerm(loc.name);
        setIsLocationSelectorsExpanded(true);
        setFocusedPinLatLng([loc.lat, loc.lng]);
        setIsEditing(false);

        if (!loc.pcode.startsWith('CUSTOM_')) {
            setActiveCustomLocation(null);
            const type = loc.pcode.length === 2 ? 'province' : loc.pcode.length === 4 ? 'district' : loc.pcode.length === 6 ? 'commune' : 'village';
            handleAreaSelect(type as any, loc.pcode);
        } else {
            setActiveCustomLocation(loc);
            let pCode = '', dCode = '', cCode = '';
            if (loc.province) {
                const searchProv = String(loc.province).trim();
                const p = data.find(x => x.khmer === searchProv || x.latin === searchProv);
                if (p) {
                    pCode = p.code;
                    if (loc.district && p.districts) {
                        const searchDist = String(loc.district).trim();
                        const d = p.districts.find(x => x.khmer === searchDist || x.latin === searchDist);
                        if (d) {
                            dCode = d.code;
                            if (loc.commune && d.communes) {
                                const searchComm = String(loc.commune).trim();
                                const c = d.communes.find(x => x.khmer === searchComm || x.latin === searchComm);
                                if (c) cCode = c.code;
                            }
                        }
                    }
                }
            }
            if (pCode) {
                handleSelectSearchResult(pCode, dCode, cCode, '');
                setActiveCustomLocation(loc); // Restore it because handleSelectSearchResult clears it
            } else {
                handleSelectSearchResult('', '', '', '');
                setActiveCustomLocation(loc);
            }
        }
    };

    const modalActiveDistricts = useMemo(() =>
        data.find(p => p.khmer === modalData.province)?.districts || [], [data, modalData.province]
    );

    const modalActiveCommunes = useMemo(() =>
        modalActiveDistricts.find(d => d.khmer === modalData.district)?.communes || [], [modalActiveDistricts, modalData.district]
    );

    const handleSaveLocationClick = () => {
        if (!editMarkerLatLng) return;

        // Determine what target the user is currently focused on
        let targetProvince = '';
        let targetDistrict = '';
        let targetCommune = '';
        let targetName = '';

        if (selectedProvinceCode) targetProvince = selectedProvince?.khmer || '';
        if (selectedDistrictCode) targetDistrict = selectedDistrict?.khmer || '';
        if (selectedCommuneCode) targetCommune = selectedCommune?.khmer || '';

        if (selectedVillageCode) {
            targetName = activeVillages.find(v => v.code === selectedVillageCode)?.khmer || '';
        } else {
            targetName = targetCommune || targetDistrict || targetProvince || '';
        }

        setSavingError(null);
        setModalData({
            name: targetName,
            courier: shippingCompanies.length > 0 ? shippingCompanies[0] : '',
            province: targetProvince,
            district: targetDistrict,
            commune: targetCommune,
            phone: '',
            contactName: '',
            isShutdown: false
        });
        setEditingLocationId(null);
        setIsSaveModalOpen(true);
    };

    const handleEditPinBtnClick = (loc: any) => {
        setEditingLocationId(loc.id);
        setEditMarkerLatLng([loc.lat, loc.lng]);
        setModalData({
            name: loc.name || '',
            courier: loc.courier || '',
            province: loc.province || '',
            district: loc.district || '',
            commune: loc.commune || '',
            phone: loc.phone || '',
            contactName: loc.contact_name || '',
            isShutdown: loc.is_shutdown || false
        });
        setIsSaveModalOpen(true);
    };

    const submitSaveLocation = async () => {
        setSavingError(null);
        if (!editMarkerLatLng) {
            setSavingError("No marker location selected.");
            return;
        }

        if (!modalData.name.trim()) {
            setSavingError("សូមបញ្ចូលឈ្មោះទីតាំង (Enter custom location name)");
            return;
        }

        const targetPcode = 'CUSTOM_' + Date.now().toString();

        setIsSavingLocation(true);
        try {
            if (editingLocationId) {
                const { error: updateError } = await supabase.from(tableName).update({
                    name: modalData.name.trim(),
                    lat: editMarkerLatLng[0],
                    lng: editMarkerLatLng[1],
                    courier: modalData.courier || null,
                    province: modalData.province || null,
                    district: modalData.district || null,
                    commune: modalData.commune || null,
                    phone: modalData.phone || null,
                    contact_name: modalData.contactName || null,
                    is_shutdown: modalData.isShutdown || false,
                    updated_at: new Date().toISOString()
                }).eq('id', editingLocationId);

                if (updateError) {
                    console.error("Supabase Update Error:", updateError);
                    throw updateError;
                }
            } else {
                const { error: insertError } = await supabase.from(tableName).insert({
                    pcode: targetPcode,
                    name: modalData.name.trim(),
                    lat: editMarkerLatLng[0],
                    lng: editMarkerLatLng[1],
                    type: 'custom',
                    courier: modalData.courier || null,
                    province: modalData.province || null,
                    district: modalData.district || null,
                    commune: modalData.commune || null,
                    phone: modalData.phone || null,
                    contact_name: modalData.contactName || null,
                    is_shutdown: modalData.isShutdown || false,
                    updated_at: new Date().toISOString()
                });

                if (insertError) {
                    console.error("Supabase Insert Error:", insertError);
                    throw insertError;
                }
            }

            setIsEditing(false);
            setEditMarkerLatLng(null);
            setEditingLocationId(null);
            setIsSaveModalOpen(false);
            await loadCustomLocations();
            alert(`Location specifically mapped to ${modalData.name}!`);
        } catch (e: any) {
            console.error('Catch Block Error in submitSaveLocation API:', e);
            setSavingError(e.message || JSON.stringify(e));
        } finally {
            setIsSavingLocation(false);
        }
    };

    const handleToggleShutdown = async (loc: any) => {
        const newStatus = !loc.is_shutdown;
        setIsSavingLocation(true);
        try {
            const { error } = await supabase.from(tableName).update({
                is_shutdown: newStatus,
                updated_at: new Date().toISOString()
            }).eq('id', loc.id);

            if (error) throw error;
            await loadCustomLocations();
            showToast(`Location "${loc.name}" is now ${newStatus ? 'Temporarily Shutdown' : 'Reactivated'}`, 'success');
        } catch (e: any) {
            console.error('Error toggling shutdown status', e);
            showToast('Failed to toggle status: ' + e.message, 'error');
        } finally {
            setIsSavingLocation(false);
        }
    };

    const handleRemovePinById = async (id: string, name: string) => {
        if (!confirm(`តើអ្នកពិតជាចង់លុបទីតាំង "${name}" មែនទេ?`)) return;

        setIsSavingLocation(true);
        try {
            const { error } = await supabase.from(tableName).delete().eq('id', id);
            if (error) throw error;
            setIsConfirmingDelete(false);
            setEditMarkerLatLng(null);
            await loadCustomLocations();
            alert(`Location pin removed for ${name}!`);
        } catch (e: any) {
            console.error('Exception during delete', e);
            alert('Error removing location pin: ' + e.message);
        } finally {
            setIsSavingLocation(false);
        }
    };

    const handleRemoveLocation = async (e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        console.log('handleRemoveLocation triggered!');

        // Determine what target the user is currently focused on
        let targetPcode = '';
        let targetName = '';

        if (activeCustomLocation) {
            targetPcode = activeCustomLocation.pcode;
            targetName = activeCustomLocation.name;
        } else if (selectedVillageCode) {
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

        console.log('Target to remove:', targetPcode, targetName);

        if (!targetPcode) {
            alert('Please select a custom pin or a geographic location first.');
            return;
        }

        setIsSavingLocation(true);
        try {
            console.log('Sending delete request to supabase...');
            const { error, data } = await supabase.from(tableName).delete().eq('pcode', targetPcode).select();
            console.log('Delete response:', error, data);

            if (error) {
                console.error('Delete error', error);
                throw error;
            }
            if (!data || data.length === 0) {
                console.warn('No rows deleted - RLS issue?');
                alert('Warning: No map pin was deleted. This might be a database permission issue.');
            } else {
                setEditMarkerLatLng(null);
                await loadCustomLocations();
                setIsConfirmingDelete(false);
                alert(`Location pin removed for ${targetName}!`);
            }
        } catch (e: any) {
            console.error('Exception during delete', e);
            alert('Error removing location pin: ' + e.message);
        } finally {
            setIsSavingLocation(false);
        }
    };

    const handleConfirmSelection = () => {
        if (!onSelect) return;

        if (activeCustomLocation) {
            let resolvedProvince = activeCustomLocation.province || '';
            let resolvedProvinceLatin = '';
            if (!resolvedProvince && !activeCustomLocation.pcode.startsWith('CUSTOM_')) {
                const p = data.find(x => x.code === activeCustomLocation.pcode.substring(0, 2));
                if (p) {
                    resolvedProvince = p.khmer;
                    resolvedProvinceLatin = p.latin;
                }
            } else if (resolvedProvince) {
                const p = data.find(x => x.khmer === resolvedProvince || x.latin === resolvedProvince);
                if (p) resolvedProvinceLatin = p.latin;
            }

            onSelect({
                province: resolvedProvince,
                provinceLatin: resolvedProvinceLatin,
                district: activeCustomLocation.district || '',
                commune: activeCustomLocation.commune || '',
                village: '',
                addressDetail: activeCustomLocation.name,
                customName: activeCustomLocation.name,
                courier: activeCustomLocation.courier || '',
                phone: activeCustomLocation.phone || '',
                contactName: activeCustomLocation.contact_name || ''
            });
            return;
        }

        // Otherwise fallback to hierachy selection
        let targetPcode = '';
        if (selectedVillageCode) targetPcode = selectedVillageCode;
        else if (selectedCommuneCode) targetPcode = selectedCommuneCode;
        else if (selectedDistrictCode) targetPcode = selectedDistrictCode;
        else if (selectedProvinceCode) targetPcode = selectedProvinceCode;

        if (!targetPcode && !focusedPinLatLng) {
            alert("សូមជ្រើសរើសទីតាំងជាមុនសិន (Please select a location first)");
            return;
        }

        const villageName = activeVillages.find(v => v.code === selectedVillageCode)?.khmer;

        onSelect({
            province: selectedProvince?.khmer || '',
            district: selectedDistrict?.khmer || '',
            commune: selectedCommune?.khmer || '',
            village: villageName || '',
            addressDetail: villageName || '',
            customName: '',
            courier: '',
            phone: '',
            contactName: ''
        });
    };


    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {!hideHeader && (
                <div className="shipping-header" style={{ padding: '24px 24px 16px', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '8px' }}>{mode === 'selector' ? 'ជ្រើសរើសទីតាំង (Select Location)' : (pageTitle || 'កំណត់ទីតាំងទម្លាក់ប៉ាល់ (Map Pinning)')}</h1>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '15px', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Map size={18} />
                            {mode === 'selector' ? 'Select a location to dispatch the order' : (pageSubtitle || 'បង្កើតទីតាំងដែលបានកំណត់សម្រាប់ការចាត់ថ្នាក់ ឬស្វែងរក (Pin specific locations for easier access)')}
                        </p>
                    </div>
                    {mode === 'selector' && onClose && (
                        <button onClick={onClose} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, color: 'var(--color-text-main)' }}>
                            <X size={18} /> បិទ (Close)
                        </button>
                    )}
                </div>
            )}

            <div className="shipping-layout" style={{
                flex: 1,
                padding: '0 24px 24px',
                display: 'grid',
                gridTemplateColumns: 'minmax(380px, 500px) 1fr',
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

                        {/* Hierarchy Selectors Block */}
                        <div
                            onClick={() => setIsLocationSelectorsExpanded(!isLocationSelectorsExpanded)}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isLocationSelectorsExpanded ? '8px' : '0', cursor: 'pointer' }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Navigation size={18} color="var(--color-primary)" />
                                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-main)' }}>ជ្រើសរើសទីតាំង</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {(selectedProvinceCode || selectedDistrictCode || selectedCommuneCode || selectedVillageCode) && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleSelectSearchResult('', '', '', ''); }}
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
                                        <X size={14} /> បោះបង់
                                    </button>
                                )}
                                <div style={{ color: 'var(--color-text-secondary)' }}>
                                    {isLocationSelectorsExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                </div>
                            </div>
                        </div>

                        {isLocationSelectorsExpanded && (
                            <>
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
                                                            onClick={() => {
                                                                if (mode === 'selector' && onSelect) {


                                                                    // Try to determine breakdown from data tree
                                                                    let dName = '', cName = '', vName = '';
                                                                    const p = data.find(x => x.code === res.pcode);
                                                                    if (p && res.dcode) {
                                                                        const d = p.districts?.find(x => x.code === res.dcode);
                                                                        dName = d?.khmer || '';
                                                                        if (d && res.ccode) {
                                                                            const c = d.communes?.find(x => x.code === res.ccode);
                                                                            cName = c?.khmer || '';
                                                                            if (c && res.vcode) {
                                                                                const v = c.villages?.find(x => x.code === res.vcode);
                                                                                vName = v?.khmer || '';
                                                                            }
                                                                        }
                                                                    }

                                                                    onSelect({
                                                                        province: p?.khmer || '',
                                                                        district: dName,
                                                                        commune: cName,
                                                                        village: vName,
                                                                        addressDetail: vName || cName || dName || p?.khmer || '',
                                                                        customName: '',
                                                                        courier: '',
                                                                        phone: '',
                                                                        contactName: ''
                                                                    });
                                                                } else {
                                                                    handleSelectSearchResult(res.pcode, res.dcode, res.ccode, res.vcode)
                                                                }
                                                            }}
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

                                {/* Village Select */}
                                <div>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>ភូមិ</label>
                                    <select
                                        value={selectedVillageCode}
                                        onChange={handleVillageChange}
                                        disabled={!selectedCommuneCode}
                                        style={{
                                            width: '100%',
                                            padding: '10px 14px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)',
                                            background: !selectedCommuneCode ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
                                            color: 'var(--color-text-main)',
                                            fontSize: '14px',
                                            outline: 'none',
                                            opacity: !selectedCommuneCode ? 0.6 : 1
                                        }}
                                    >
                                        <option value="">-- បង្ហាញភូមិ --</option>
                                        {activeVillages.map(village => (
                                            <option key={village.code} value={village.code}>
                                                {village.khmer} ({village.latin})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </>
                        )}


                        {/* Saved Pins Panel */}
                        <div style={{ background: 'var(--color-surface)', borderRadius: '16px', border: '1px solid var(--color-border)', padding: '20px', boxShadow: '0 2px 10px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', maxHeight: isPinnedListExpanded ? '400px' : 'auto' }}>
                            <div
                                onClick={() => setIsPinnedListExpanded(!isPinnedListExpanded)}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isPinnedListExpanded ? '16px' : '0', cursor: 'pointer' }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <MapPin size={18} color="var(--color-primary)" />
                                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--color-text-main)' }}>ទីតាំងដែលបានកំណត់ ({pinnedLocationsByProvince.reduce((sum, g) => sum + g.locations.length, 0)})</h3>
                                </div>
                                <div style={{ color: 'var(--color-text-secondary)' }}>
                                    {isPinnedListExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                </div>
                            </div>

                            {isPinnedListExpanded && (
                                <>
                                    <div style={{ position: 'relative', marginBottom: '16px', flexShrink: 0 }}>
                                        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                                        <input
                                            type="text"
                                            placeholder="ស្វែងរកទីតាំងដែលបានកំណត់..."
                                            value={searchPinnedTerm}
                                            onChange={e => setSearchPinnedTerm(e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '10px 12px 10px 36px',
                                                borderRadius: '8px',
                                                border: '1px solid var(--color-border)',
                                                background: 'var(--color-bg)',
                                                color: 'var(--color-text-main)',
                                                fontSize: '14px',
                                                outline: 'none',
                                            }}
                                        />
                                        {searchPinnedTerm && (
                                            <button
                                                onClick={() => setSearchPinnedTerm('')}
                                                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex' }}
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>

                                    <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
                                        {pinnedLocationsByProvince.length === 0 ? (
                                            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                                មិនទាន់មានទីតាំងបានកំណត់ទេ
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                {pinnedLocationsByProvince.map(group => (
                                                    <div key={group.provinceName} style={{ border: '1px solid var(--color-border)', borderRadius: '12px', overflow: 'hidden' }}>
                                                        <div
                                                            onClick={() => group.provinceCode && handleAreaSelect('province', group.provinceCode)}
                                                            style={{
                                                                background: 'var(--color-bg)',
                                                                padding: '10px 14px',
                                                                borderBottom: '1px solid var(--color-border)',
                                                                fontSize: '14px',
                                                                fontWeight: 600,
                                                                color: 'var(--color-text-main)',
                                                                cursor: group.provinceCode ? 'pointer' : 'default',
                                                                transition: 'background 0.2s'
                                                            }}
                                                            onMouseEnter={(e) => { if (group.provinceCode) e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                                                            onMouseLeave={(e) => { if (group.provinceCode) e.currentTarget.style.background = 'var(--color-bg)' }}
                                                        >
                                                            {group.provinceName}
                                                        </div>
                                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                            {group.locations.map((loc, idx) => {
                                                                return (
                                                                    <div
                                                                        key={loc.id || loc.pcode + idx}
                                                                        style={{
                                                                            padding: '8px 14px',
                                                                            borderBottom: idx < group.locations.length - 1 ? '1px solid var(--color-border)' : 'none',
                                                                            background: 'var(--color-surface)',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'space-between',
                                                                            transition: 'background 0.2s',
                                                                            opacity: loc.is_shutdown ? 0.6 : 1
                                                                        }}
                                                                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg)'}
                                                                        onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-surface)'}
                                                                    >
                                                                        <div
                                                                            onClick={() => {
                                                                                if (mode === 'selector' && onSelect) {
                                                                                    let resolvedProvince = loc.province || '';
                                                                                    let resolvedProvinceLatin = '';
                                                                                    if (!resolvedProvince && loc.pcode) {
                                                                                        const provinceCode = loc.pcode.substring(0, 2);
                                                                                        const p = data.find(x => x.code === provinceCode);
                                                                                        if (p) {
                                                                                            resolvedProvince = p.khmer;
                                                                                            resolvedProvinceLatin = p.latin;
                                                                                        }
                                                                                    } else if (resolvedProvince) {
                                                                                        const p = data.find(x => x.khmer === resolvedProvince || x.latin === resolvedProvince);
                                                                                        if (p) resolvedProvinceLatin = p.latin;
                                                                                    }
                                                                                    onSelect({
                                                                                        province: resolvedProvince,
                                                                                        provinceLatin: resolvedProvinceLatin,
                                                                                        district: loc.district || '',
                                                                                        commune: loc.commune || '',
                                                                                        village: '',
                                                                                        addressDetail: loc.name,
                                                                                        customName: loc.name,
                                                                                        courier: loc.courier || '',
                                                                                        phone: loc.phone || '',
                                                                                        contactName: loc.contact_name || ''
                                                                                    });
                                                                                    return;
                                                                                }

                                                                                handleMarkerClick(loc);
                                                                            }}
                                                                            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1 }}
                                                                        >
                                                                            <MapPin size={12} color="var(--color-text-secondary)" />
                                                                            <span style={{ fontSize: '11px', color: loc.is_shutdown ? 'var(--color-text-secondary)' : 'var(--color-text-main)', display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>
                                                                                {[loc.name, loc.commune, loc.district, loc.province?.replace(/ខេត្ត\s*|រាជធានី\s*/g, '').trim()].filter(Boolean).join(', ')}
                                                                                {loc.is_shutdown && (
                                                                                    <span style={{ 
                                                                                        background: '#fee2e2', 
                                                                                        color: '#dc2626', 
                                                                                        fontSize: '10px', 
                                                                                        padding: '1px 5px', 
                                                                                        borderRadius: '4px', 
                                                                                        marginLeft: '6px', 
                                                                                        fontWeight: 600,
                                                                                        display: 'inline-block' 
                                                                                    }}>
                                                                                        Shutdown
                                                                                    </span>
                                                                                )}
                                                                            </span>
                                                                        </div>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    const cleanProv = loc.province?.replace(/ខេត្ត\s*|រាជធានី\s*/g, '').trim();
                                                                                    const addressString = [loc.name, loc.commune, loc.district, cleanProv].filter(Boolean).join(', ');
                                                                                    navigator.clipboard.writeText(addressString);
                                                                                    showToast('Location copied to clipboard', 'success');
                                                                                }}
                                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', color: 'var(--color-text-secondary)', transition: 'color 0.2s' }}
                                                                                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-primary)'}
                                                                                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-secondary)'}
                                                                                title="ចម្លងទីតាំង (Copy Location)"
                                                                            >
                                                                                <Copy size={13} />
                                                                            </button>
                                                                            {loc.id && (
                                                                                <>
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleToggleShutdown(loc);
                                                                                        }}
                                                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', color: loc.is_shutdown ? 'var(--color-success)' : 'var(--color-text-secondary)', transition: 'color 0.2s' }}
                                                                                        onMouseEnter={(e) => e.currentTarget.style.color = loc.is_shutdown ? 'var(--color-success)' : 'var(--color-danger)'}
                                                                                        onMouseLeave={(e) => e.currentTarget.style.color = loc.is_shutdown ? 'var(--color-success)' : 'var(--color-text-secondary)'}
                                                                                        title={loc.is_shutdown ? "បើកដំណើរការឡើងវិញ (Reactivate)" : "បិទជាបណ្តោះអាសន្ន (Temporary Shutdown)"}
                                                                                    >
                                                                                        <Power size={13} />
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleEditPinBtnClick(loc);
                                                                                        }}
                                                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', color: 'var(--color-text-secondary)', transition: 'color 0.2s' }}
                                                                                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-primary)'}
                                                                                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-secondary)'}
                                                                                        title="កែពត៌មានទីតាំង(Edit)"
                                                                                    >
                                                                                        <Edit2 size={13} />
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleRemovePinById(loc.id, loc.name);
                                                                                        }}
                                                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', color: 'var(--color-text-secondary)', transition: 'color 0.2s' }}
                                                                                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
                                                                                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-secondary)'}
                                                                                        title="លុបទីតាំងនេះ"
                                                                                    >
                                                                                        <Trash2 size={13} />
                                                                                    </button>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Shutdown Checkpoints Panel */}
                    {customLocations.some(loc => loc.is_shutdown) && (
                        <div style={{
                            background: 'var(--color-surface)',
                            borderRadius: '16px',
                            border: '1px solid var(--color-border)',
                            borderLeft: '4px solid var(--color-danger, #ef4444)',
                            padding: '20px',
                            boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <AlertTriangle size={18} color="var(--color-danger, #ef4444)" />
                                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                                    ទីតាំងផ្អាកជាបណ្តោះអាសន្ន (Shutdown Checkpoints) ({customLocations.filter(loc => loc.is_shutdown).length})
                                </h3>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
                                {customLocations.filter(loc => loc.is_shutdown).map((loc, idx) => (
                                    <div 
                                        key={loc.id || loc.pcode + idx}
                                        style={{
                                            padding: '12px',
                                            background: 'var(--color-bg)',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: '8px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '6px'
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                                            <div style={{ fontWeight: 600, color: 'var(--color-text-main)', fontSize: '14px' }}>
                                                {loc.name}
                                            </div>
                                            <button
                                                onClick={() => handleToggleShutdown(loc)}
                                                style={{
                                                    background: 'none',
                                                    cursor: 'pointer',
                                                    color: 'var(--color-success)',
                                                    fontSize: '12px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    padding: '4px 8px',
                                                    backgroundColor: 'var(--color-success-light, #ecfdf5)',
                                                    border: '1px solid var(--color-success, #10b981)',
                                                    borderRadius: '6px',
                                                    fontWeight: 500
                                                }}
                                                title="បើកដំណើរការឡើងវិញ (Reactivate)"
                                            >
                                                <Power size={12} /> បើកឡើងវិញ
                                            </button>
                                        </div>

                                        {loc.courier && (
                                            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                <strong style={{ color: 'var(--color-primary)' }}>សេវាកម្ម:</strong> {loc.courier}
                                            </div>
                                        )}
                                        
                                        {(loc.province || loc.district || loc.commune) && (
                                            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                                <strong>តំបន់:</strong> {[loc.province, loc.district, loc.commune].filter(Boolean).join(' > ')}
                                            </div>
                                        )}

                                        {(loc.contact_name || loc.phone) && (
                                            <div style={{ 
                                                fontSize: '12px', 
                                                color: 'var(--color-text-secondary)',
                                                display: 'flex',
                                                flexWrap: 'wrap',
                                                gap: '8px',
                                                marginTop: '2px',
                                                paddingTop: '6px',
                                                borderTop: '1px dashed var(--color-border)'
                                            }}>
                                                {loc.contact_name && <span><strong>ឈ្មោះ:</strong> {loc.contact_name}</span>}
                                                {loc.phone && <span><strong>ទូរស័ព្ទ:</strong> {loc.phone}</span>}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>


                {/* Right Panel: Interactive Map */}
                <div className="shipping-map-container" style={{
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
                                    onClick={handleSaveLocationClick}
                                    disabled={!editMarkerLatLng || isSavingLocation}
                                    style={{ padding: '8px 16px', background: 'var(--color-primary)', border: 'none', color: '#fff', fontWeight: 500, cursor: (!editMarkerLatLng || isSavingLocation) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: (!editMarkerLatLng || isSavingLocation) ? 0.7 : 1 }}
                                >
                                    <Save size={16} /> រក្សាទុក
                                </button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', gap: '8px' }}>
                                {isConfirmingDelete ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--color-danger-light, #fee2e2)', padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--color-danger, #ef4444)' }}>
                                        <span style={{ fontSize: '13px', color: 'var(--color-danger, #ef4444)', fontWeight: 500 }}>លុបទីតាំងនេះ?</span>
                                        <button
                                            onClick={() => setIsConfirmingDelete(false)}
                                            style={{ padding: '6px 12px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px', color: 'var(--color-text-main)', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
                                        >
                                            ទេ (No)
                                        </button>
                                        <button
                                            onClick={handleRemoveLocation}
                                            disabled={isSavingLocation}
                                            style={{ padding: '6px 12px', background: 'var(--color-danger, #ef4444)', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: isSavingLocation ? 'not-allowed' : 'pointer', opacity: isSavingLocation ? 0.7 : 1 }}
                                        >
                                            {isSavingLocation ? '...' : 'យល់ព្រម (Yes)'}
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        {activeCustomLocation && (
                                            <button
                                                onClick={() => {
                                                    setActiveCustomLocation(null);
                                                    setFocusedPinLatLng(null);
                                                    setSearchPinnedTerm('');
                                                }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '8px',
                                                    padding: '8px 16px',
                                                    background: 'var(--color-surface)',
                                                    border: '1px solid var(--color-border)',
                                                    borderRadius: '8px',
                                                    color: 'var(--color-text-secondary)',
                                                    fontWeight: 500,
                                                    cursor: 'pointer',
                                                    boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
                                                }}
                                            >
                                                <X size={16} /> Exit Selected Point
                                            </button>
                                        )}
                                        {mode === 'selector' && (
                                            <button
                                                onClick={handleConfirmSelection}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '8px',
                                                    padding: '8px 16px',
                                                    background: 'var(--color-success, #10b981)',
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    color: '#fff',
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.2)'
                                                }}
                                            >
                                                <MapPin size={16} /> បញ្ជាក់ទីតាំង (Confirm)
                                            </button>
                                        )}
                                        {!isConfirmingDelete && (
                                            <button
                                                onClick={() => {
                                                    setIsEditing(true); // Activate Map Pin dropping directly
                                                }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '8px',
                                                    padding: '8px 16px',
                                                    background: 'var(--color-primary)',
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    color: '#fff',
                                                    fontWeight: 500,
                                                    cursor: 'pointer',
                                                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                                                }}
                                            >
                                                <MapPin size={16} /> បន្ថែមទីតាំងថ្មី
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                    {isEditing && (
                        <div style={{ position: 'absolute', top: 16, left: 16, right: 'auto', zIndex: 10, background: 'var(--color-primary-light)', color: 'var(--color-primary)', padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--color-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                            <MapPin size={18} /> សូមចុចលើផែនទីដើម្បីទម្លាក់ប៉ាល់, រួចទាញ (Tap on map to drop pin, drag to refine)
                        </div>
                    )}

                    {isSaveModalOpen && (
                        <div style={{
                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50,
                            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <div style={{
                                width: '400px', background: 'var(--color-surface)', borderRadius: '16px', padding: '24px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                                display: 'flex', flexDirection: 'column', gap: '16px'
                            }}>
                                <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-text-main)', margin: 0 }}>{editingLocationId ? 'កែពត៌មានទីតាំង (Edit Location)' : 'រក្សាទុកទីតាំង (Save Location)'}</h3>

                                {savingError && (
                                    <div style={{ padding: '12px', background: '#ffebee', color: '#d32f2f', borderRadius: '8px', fontSize: '13px', fontWeight: 500 }}>
                                        {savingError}
                                    </div>
                                )}

                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Location Name / ឈ្មោះទីតាំង *</label>
                                    <input
                                        type="text" value={modalData.name} onChange={(e) => setModalData({ ...modalData, name: e.target.value })}
                                        style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: '8px', outline: 'none' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Courier / សេវាដឹកជញ្ជូន</label>
                                    <select
                                        value={modalData.courier} onChange={(e) => setModalData({ ...modalData, courier: e.target.value })}
                                        style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: '8px', outline: 'none', background: 'var(--color-surface)' }}
                                    >
                                        <option value="">Select Courier</option>
                                        {shippingCompanies.map(c => <option key={c} value={c} style={{ color: getShippingCoColor(c) }}>{c}</option>)}
                                    </select>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Province / ខេត្ត</label>
                                        <select value={modalData.province} onChange={(e) => setModalData({ ...modalData, province: e.target.value, district: '', commune: '' })} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: '8px', outline: 'none', background: 'var(--color-surface)' }}>
                                            <option value="">Select Province</option>
                                            {data.map(p => <option key={p.code} value={p.khmer}>{p.khmer}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>District / ស្រុក</label>
                                        <select value={modalData.district} onChange={(e) => setModalData({ ...modalData, district: e.target.value, commune: '' })} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: '8px', outline: 'none', background: 'var(--color-surface)' }}>
                                            <option value="">Select District</option>
                                            {modalActiveDistricts.map(d => <option key={d.code} value={d.khmer}>{d.khmer}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Commune / ឃុំ</label>
                                        <select value={modalData.commune} onChange={(e) => setModalData({ ...modalData, commune: e.target.value })} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: '8px', outline: 'none', background: 'var(--color-surface)' }}>
                                            <option value="">Select Commune</option>
                                            {modalActiveCommunes.map(c => <option key={c.code} value={c.khmer}>{c.khmer}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Phone / លេខទូរស័ព្ទ</label>
                                        <input type="text" value={modalData.phone} onChange={(e) => setModalData({ ...modalData, phone: e.target.value })} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: '8px', outline: 'none' }} />
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Contact Name / ឈ្មោះអ្នកទទួល</label>
                                    <input type="text" value={modalData.contactName} onChange={(e) => setModalData({ ...modalData, contactName: e.target.value })} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: '8px', outline: 'none' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: 'var(--color-text-main)' }}>
                                        <input
                                            type="checkbox"
                                            checked={modalData.isShutdown}
                                            onChange={(e) => setModalData({ ...modalData, isShutdown: e.target.checked })}
                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                        />
                                        <span>បិទទីតាំងនេះជាបណ្តោះអាសន្ន (Temporarily Shutdown)</span>
                                    </label>
                                </div>

                                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                    <button
                                        onClick={() => setIsSaveModalOpen(false)}
                                        style={{ flex: 1, padding: '12px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', color: 'var(--color-text-main)', fontWeight: 500, cursor: 'pointer' }}
                                    >Cancel</button>
                                    <button
                                        onClick={submitSaveLocation}
                                        disabled={isSavingLocation}
                                        style={{ flex: 1, padding: '12px', background: 'var(--color-primary)', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 500, cursor: isSavingLocation ? 'not-allowed' : 'pointer', opacity: isSavingLocation ? 0.7 : 1 }}
                                    >{isSavingLocation ? 'Saving...' : 'Save Location'}</button>
                                </div>
                            </div>
                        </div>
                    )}


                    <CambodiaMap
                        selectedProvinceCode={selectedProvinceCode}
                        selectedDistrictCode={selectedDistrictCode}
                        selectedCommuneCode={selectedCommuneCode}
                        selectedVillageCode={selectedVillageCode}
                        isEditing={isEditing}
                        editMarkerLatLng={editMarkerLatLng}
                        onMapClick={handleMapClick}
                        onMarkerClick={handleMarkerClick}
                        onPopupClose={() => {
                            setActiveCustomLocation(null);
                            setFocusedPinLatLng(null);
                            setSearchPinnedTerm('');
                        }}
                        customLocations={customLocations}
                        focusedPinLatLng={focusedPinLatLng}
                        mapSource={mapSource}
                    />
                </div>

                {/* Grid container closes here */}
            </div >

            <style>{`
                @keyframes spin { 100% { transform: rotate(360deg); } }
                @media (max-width: 1024px) {
                    .shipping-layout {
                        grid-template-columns: 1fr !important;
                    }
                }
                @media (max-width: 640px) {
                    .shipping-layout {
                        padding: 0 16px 16px !important;
                        gap: 16px !important;
                    }
                    .shipping-header {
                        padding: 16px 16px 12px !important;
                    }
                    .shipping-header h1 {
                        font-size: 20px !important;
                    }
                    .shipping-map-container {
                        min-height: 500px !important;
                    }
                }
            `}</style>
        </div >
    );
};
