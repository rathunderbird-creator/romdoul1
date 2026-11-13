// The merged address tree (gazetteer + Sales Setup's custom/hidden
// districts and communes — see utils/locationTree.ts) for any picker.
//
// cambodia.json is ~85k lines, so it is lazy-imported once per session and
// shared by every caller instead of each component importing it again.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { buildLocationTree, type LocProvince, type LocationOverrides } from '../utils/locationTree';

let gazetteerPromise: Promise<LocProvince[]> | null = null;
export const loadGazetteer = (): Promise<LocProvince[]> => {
    if (!gazetteerPromise) {
        gazetteerPromise = import('../data/cambodia.json')
            .then(mod => mod.default as unknown as LocProvince[])
            .catch(err => { gazetteerPromise = null; throw err; });
    }
    return gazetteerPromise;
};

export function useLocationTree(): { tree: LocProvince[]; loaded: boolean } {
    const { customDistricts, customCommunes, removedDistrictCodes, removedCommuneCodes } = useStore();
    const [gazetteer, setGazetteer] = useState<LocProvince[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        loadGazetteer()
            .then(g => { if (!cancelled) setGazetteer(g); })
            .catch(err => console.error('Failed to load gazetteer data:', err));
        return () => { cancelled = true; };
    }, []);

    // The store hands out a fresh `[]` each render when a key is unset, so
    // key the memo on content rather than identity.
    const overridesKey = JSON.stringify([
        Array.isArray(customDistricts) ? customDistricts : [],
        Array.isArray(customCommunes) ? customCommunes : [],
        Array.isArray(removedDistrictCodes) ? removedDistrictCodes : [],
        Array.isArray(removedCommuneCodes) ? removedCommuneCodes : [],
    ]);
    const tree = useMemo(() => {
        if (!gazetteer) return [];
        const [cd, cc, rd, rc] = JSON.parse(overridesKey) as [
            LocationOverrides['customDistricts'], LocationOverrides['customCommunes'], string[], string[]
        ];
        return buildLocationTree(gazetteer, { customDistricts: cd, customCommunes: cc, removedDistrictCodes: rd, removedCommuneCodes: rc });
    }, [gazetteer, overridesKey]);

    return { tree, loaded: gazetteer !== null };
}
