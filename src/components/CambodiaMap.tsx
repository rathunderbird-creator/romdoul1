import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// OVERRIDE: Prevent "We is not defined" global crash in Vite production builds.
// By loading the pre-minified worker from the CDN, Vite cannot mangle the internal `global` references.
(maplibregl as any).workerUrl = "https://unpkg.com/maplibre-gl@5.19.0/dist/maplibre-gl-csp-worker.js";

export interface ShippingRule {
    pcode: string;
    name: string;
    is_shippable: boolean;
    shipping_fee: number;
    estimated_days: string;
    supported_couriers: string[];
}

interface CambodiaMapProps {
    selectedProvinceCode?: string;
    selectedDistrictCode?: string;
    selectedCommuneCode?: string;
    selectedVillageCode?: string;
    isEditing?: boolean;
    editMarkerLatLng?: [number, number] | null;
    onMapClick?: (lat: number, lng: number) => void;
    onAreaSelect?: (type: 'province' | 'district' | 'commune' | 'village', code: string) => void;
    customLocations?: Array<{ pcode: string, name?: string, lat: number, lng: number }>;
    shippingRules?: ShippingRule[];
}

const CAMBODIA_CENTER: [number, number] = [104.9, 12.5];

export const CambodiaMap: React.FC<CambodiaMapProps> = ({
    selectedProvinceCode,
    selectedDistrictCode,
    selectedCommuneCode,
    selectedVillageCode,
    isEditing = false,
    editMarkerLatLng = null,
    onMapClick,
    onAreaSelect,
    customLocations = [],
    shippingRules = []
}) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);
    const ruleMarkersRef = useRef<maplibregl.Marker[]>([]);
    const centroidsRef = useRef<Record<string, [number, number]>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Helper to get geometry bounds for zooming
    const getGeometryBounds = useCallback((geometry: maplibregl.MapGeoJSONFeature['geometry']): maplibregl.LngLatBounds | null => {
        const bounds = new maplibregl.LngLatBounds();
        if (geometry.type === 'Polygon') {
            const rings = geometry.coordinates as [number, number][][];
            rings.forEach(ring => ring.forEach(coord => bounds.extend(coord)));
            return bounds;
        }
        if (geometry.type === 'MultiPolygon') {
            const polygons = geometry.coordinates as [number, number][][][];
            polygons.forEach(polygon => polygon.forEach(ring => ring.forEach(coord => bounds.extend(coord))));
            return bounds;
        }
        return null;
    }, []);

    // Main map initialization
    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) return;

        // Ensure container has dimensions before initializing
        const { clientWidth, clientHeight } = mapContainerRef.current;
        if (clientWidth === 0 || clientHeight === 0) {
            // If rendered hidden or zero-size, don't initialize yet
            // In a perfect world we'd use a ResizeObserver here, but a small delay helps React finish laying out
            const timer = setTimeout(() => {
                setIsLoading((prev) => prev); // force re-eval
            }, 100);
            return () => clearTimeout(timer);
        }

        // Force full URL to avoid SPA routing prefix issues in production
        const baseUrl = window.location.origin;
        const basePath = import.meta.env.BASE_URL || '/';
        const buildPath = (p: string) => {
            const path = `${basePath}${p}`.replace(/\/{2,}/g, '/');
            return `${baseUrl}${path}`;
        };

        // Fetch centroids data for zooming
        fetch(buildPath('data/geo/khm_admincentroids.geojson'))
            .then(res => res.json())
            .then(data => {
                const lookup: Record<string, [number, number]> = {};
                data.features.forEach((f: any) => {
                    const props = f.properties;
                    let pcode = props.adm3_pcode || props.adm2_pcode || props.adm1_pcode || props.adm0_pcode;
                    if (pcode && f.geometry && f.geometry.coordinates) {
                        lookup[pcode] = f.geometry.coordinates as [number, number];
                    }
                });
                centroidsRef.current = lookup;
            })
            .catch(err => console.error("Failed to load map centroids for zooming", err));

        try {
            const map = new maplibregl.Map({
                container: mapContainerRef.current,
                style: {
                    version: 8,
                    sources: {
                        'raster-tiles': {
                            type: 'raster',
                            tiles: [
                                'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
                                'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
                                'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'
                            ],
                            tileSize: 256,
                            attribution: '&copy; CARTO'
                        }
                    },
                    layers: [{
                        id: 'simple-tiles',
                        type: 'raster',
                        source: 'raster-tiles',
                        minzoom: 0,
                        maxzoom: 22
                    }]
                },
                center: CAMBODIA_CENTER,
                zoom: 6.5,
                dragRotate: false,
                pitchWithRotate: false,
                touchPitch: false,
            });

            mapRef.current = map;
            map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

            map.on('load', () => {
                // Add geojson sources using standard root path
                const baseUrl = window.location.origin;
                const basePath = import.meta.env.BASE_URL || '/';
                const buildPath = (p: string) => {
                    const path = `${basePath}${p}`.replace(/\/{2,}/g, '/');
                    return `${baseUrl}${path}`;
                };

                map.addSource('provinces', { type: 'geojson', data: buildPath('data/geo/khm_admin1.geojson') });
                map.addSource('districts', { type: 'geojson', data: buildPath('data/geo/khm_admin2.geojson') });
                map.addSource('communes', { type: 'geojson', data: buildPath('data/geo/khm_admin3.geojson') });

                // --- Base Layers ---
                map.addLayer({
                    id: 'province-base',
                    type: 'fill',
                    source: 'provinces',
                    paint: { 'fill-color': 'transparent' } // Keep source active for data queries
                });

                map.addLayer({
                    id: 'district-base',
                    type: 'fill',
                    source: 'districts',
                    paint: { 'fill-color': 'transparent' },
                    minzoom: 8
                });

                map.addLayer({
                    id: 'commune-base',
                    type: 'fill',
                    source: 'communes',
                    paint: { 'fill-color': 'transparent' },
                    minzoom: 10
                });

                map.addLayer({
                    id: 'province-outline',
                    type: 'line',
                    source: 'provinces',
                    paint: { 'line-color': '#94a3b8', 'line-width': 1, 'line-opacity': 0.8 }
                });

                // District outlines
                map.addLayer({
                    id: 'district-outline',
                    type: 'line',
                    source: 'districts',
                    paint: { 'line-color': '#cbd5e1', 'line-width': 0.5, 'line-opacity': 0.5 },
                    minzoom: 8
                });

                // --- Highlight Layers ---
                // Province Highlight
                map.addLayer({
                    id: 'province-highlight-line',
                    type: 'line',
                    source: 'provinces',
                    paint: { 'line-color': '#3b82f6', 'line-width': 2.5 },
                    filter: ['==', ['get', 'adm1_pcode'], 'NONE']
                });
                map.addLayer({
                    id: 'province-highlight-fill',
                    type: 'fill',
                    source: 'provinces',
                    paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.1 },
                    filter: ['==', ['get', 'adm1_pcode'], 'NONE']
                });

                // District Highlight
                map.addLayer({
                    id: 'district-highlight-line',
                    type: 'line',
                    source: 'districts',
                    paint: { 'line-color': '#f59e0b', 'line-width': 2 },
                    filter: ['==', ['get', 'adm2_pcode'], 'NONE']
                });
                map.addLayer({
                    id: 'district-highlight-fill',
                    type: 'fill',
                    source: 'districts',
                    paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.15 },
                    filter: ['==', ['get', 'adm2_pcode'], 'NONE']
                });

                // Commune Highlight
                map.addLayer({
                    id: 'commune-highlight-line',
                    type: 'line',
                    source: 'communes',
                    paint: { 'line-color': '#10b981', 'line-width': 1.5 },
                    filter: ['==', ['get', 'adm3_pcode'], 'NONE']
                });
                map.addLayer({
                    id: 'commune-highlight-fill',
                    type: 'fill',
                    source: 'communes',
                    paint: { 'fill-color': '#10b981', 'fill-opacity': 0.2 },
                    filter: ['==', ['get', 'adm3_pcode'], 'NONE']
                });

                setIsLoading(false);
            });

            map.on('error', (e: any) => {
                console.error("Maplibre init error:", e.error?.message || e.message || JSON.stringify(e) || e);
                setError("Failed to load map data: " + (e.error?.message || "Internal error"));
                setIsLoading(false);
            });

        } catch (err) {
            console.error(err);
            setError("Map error");
            setIsLoading(false);
        }

        return () => {
            if (markerRef.current) markerRef.current.remove();
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, []);

    // Click Handler for Editing and Area Selection
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const handleClick = (e: maplibregl.MapMouseEvent) => {
            // Handle Edit Mode clicking
            if (isEditing && onMapClick) {
                onMapClick(e.lngLat.lat, e.lngLat.lng);
                return;
            }

            // Handle Region Selection
            if (!isEditing && onAreaSelect) {
                // Query rendered features in hierarchical order (smallest to largest)
                const features = map.queryRenderedFeatures(e.point, {
                    layers: ['commune-base', 'district-base', 'province-base']
                });

                if (features.length > 0) {
                    const feature = features[0];
                    const props = feature.properties;

                    if (feature.layer.id === 'commune-base' && props.adm3_pcode) {
                        onAreaSelect('commune', props.adm3_pcode.replace('KH', ''));
                    } else if (feature.layer.id === 'district-base' && props.adm2_pcode) {
                        onAreaSelect('district', props.adm2_pcode.replace('KH', ''));
                    } else if (feature.layer.id === 'province-base' && props.adm1_pcode) {
                        onAreaSelect('province', props.adm1_pcode.replace('KH', ''));
                    }
                }
            }
        };

        map.on('click', handleClick);

        // Change cursor to indicate interactiveness
        const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
            if (isEditing) return; // Cursor is handled below for edit mode
            const features = map.queryRenderedFeatures(e.point, {
                layers: ['commune-base', 'district-base', 'province-base']
            });
            map.getCanvas().style.cursor = features.length ? 'pointer' : '';
        };

        const handleMouseLeave = () => {
            if (!isEditing) map.getCanvas().style.cursor = '';
        }

        map.on('mousemove', handleMouseMove);
        map.on('mouseleave', 'province-base', handleMouseLeave);

        map.getCanvas().style.cursor = isEditing ? 'crosshair' : '';

        return () => {
            map.off('click', handleClick);
            map.off('mousemove', handleMouseMove);
            map.off('mouseleave', 'province-base', handleMouseLeave);
            map.getCanvas().style.cursor = '';
        };
    }, [isEditing, onMapClick, onAreaSelect]);

    // Handle temporary edit marker rendering
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        if (editMarkerLatLng) {
            if (!markerRef.current) {
                markerRef.current = new maplibregl.Marker({ color: '#ef4444' })
                    .setLngLat([editMarkerLatLng[1], editMarkerLatLng[0]])
                    .addTo(map);
            } else {
                markerRef.current.setLngLat([editMarkerLatLng[1], editMarkerLatLng[0]]);
            }
        } else {
            if (markerRef.current) {
                markerRef.current.remove();
                markerRef.current = null;
            }
        }
    }, [editMarkerLatLng]);

    // Merge custom locations into centroids lookup
    useEffect(() => {
        if (customLocations && customLocations.length > 0) {
            customLocations.forEach(loc => {
                centroidsRef.current[loc.pcode] = [loc.lng, loc.lat];
            });
        }
    }, [customLocations]);

    // Render Custom Location Markers
    const customMarkersRef = useRef<maplibregl.Marker[]>([]);
    useEffect(() => {
        const map = mapRef.current;
        if (!map || isLoading) return;

        // Clean up previous custom markers
        customMarkersRef.current.forEach(marker => marker.remove());
        customMarkersRef.current = [];

        // Only draw red pins for custom locations that aren't already covered by a green Shippable rule overlay
        // to prevent overlapping markers for the exact same centroid point
        const activeRuleCodes = new Set(shippingRules.filter(r => r.is_shippable).map(r => r.pcode));

        customLocations.forEach(loc => {
            if (activeRuleCodes.has(loc.pcode)) return; // Skip if it already has a green shippable pin

            const el = document.createElement('div');
            el.className = 'custom-location-marker';
            // Simple small red dot mapping a custom location
            el.style.width = '14px';
            el.style.height = '14px';
            el.style.backgroundColor = '#ef4444'; // Red
            el.style.border = '2px solid white';
            el.style.borderRadius = '50%';
            el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
            el.style.cursor = 'pointer';

            const popupContent = `
                <div style="padding: 4px; font-family: 'Battambang', system-ui, sans-serif;">
                    <div style="font-size: 13px; color: var(--color-text-secondary);">ទីតាំងបានកំណត់:</div>
                    <h4 style="margin: 4px 0 0 0; font-size: 15px; color: var(--color-text-main); font-weight: 600;">${loc.name || loc.pcode}</h4>
                </div>
            `;

            const popup = new maplibregl.Popup({ offset: 10, closeButton: false })
                .setHTML(popupContent);

            const marker = new maplibregl.Marker({ element: el })
                .setLngLat([loc.lng, loc.lat])
                .setPopup(popup)
                .addTo(map);

            customMarkersRef.current.push(marker);
        });
    }, [customLocations, shippingRules, isLoading]);

    // Render Shipping Rule Markers
    useEffect(() => {
        const map = mapRef.current;
        if (!map || isLoading) return;

        // Clean up previous markers
        ruleMarkersRef.current.forEach(marker => marker.remove());
        ruleMarkersRef.current = [];

        // Filter for shippable rules
        const shippableRules = shippingRules.filter(r => r.is_shippable);

        shippableRules.forEach(rule => {
            const centroid = centroidsRef.current[rule.pcode];
            if (!centroid) return;

            // Create a custom HTML element for the marker to stand out
            const el = document.createElement('div');
            el.className = 'shippable-marker';
            el.style.width = '20px';
            el.style.height = '20px';
            el.style.backgroundColor = 'var(--color-success)';
            el.style.border = '2px solid white';
            el.style.borderRadius = '50%';
            el.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
            el.style.cursor = 'pointer';

            const couriersText = rule.supported_couriers?.length > 0
                ? rule.supported_couriers.join(', ')
                : 'គ្មានព័ត៌មាន';

            const popupContent = `
                <div style="padding: 4px; font-family: 'Battambang', system-ui, sans-serif;">
                    <h4 style="margin: 0 0 8px 0; font-size: 15px; color: var(--color-text-main); font-weight: 600;">${rule.name}</h4>
                    <div style="font-size: 13px; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 4px;">
                        <div style="display: flex; justify-content: space-between; gap: 12px;">
                            <span>តម្លៃដឹកជញ្ជូន:</span>
                            <span style="color: var(--color-primary); font-weight: 500;">$${rule.shipping_fee.toFixed(2)}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; gap: 12px;">
                            <span>រយះពេល:</span>
                            <span style="font-weight: 500; color: var(--color-text-main);">${rule.estimated_days || 'មិនបញ្ជាក់'}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; gap: 12px; margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--color-border);">
                            <span>សេវា:</span>
                            <span style="font-weight: 500; color: var(--color-text-main);">${couriersText}</span>
                        </div>
                    </div>
                </div>
            `;

            const popup = new maplibregl.Popup({ offset: 15, closeButton: false })
                .setHTML(popupContent);

            const marker = new maplibregl.Marker({ element: el })
                .setLngLat(centroid)
                .setPopup(popup)
                .addTo(map);

            ruleMarkersRef.current.push(marker);
        });

    }, [shippingRules, isLoading]);

    // Filter Effect
    useEffect(() => {
        const map = mapRef.current;
        if (!map || isLoading) return;

        // Apply filters based on selection
        const formattedProvince = selectedProvinceCode ? `KH${selectedProvinceCode}` : 'NONE';
        const formattedDistrict = selectedDistrictCode ? `KH${selectedDistrictCode}` : 'NONE';
        const formattedCommune = selectedCommuneCode ? `KH${selectedCommuneCode}` : 'NONE';

        // Reset all highlights
        map.setFilter('province-highlight-line', ['==', ['get', 'adm1_pcode'], formattedProvince]);
        map.setFilter('province-highlight-fill', ['==', ['get', 'adm1_pcode'], formattedProvince]);

        map.setFilter('district-highlight-line', ['==', ['get', 'adm2_pcode'], formattedDistrict]);
        map.setFilter('district-highlight-fill', ['==', ['get', 'adm2_pcode'], formattedDistrict]);

        map.setFilter('commune-highlight-line', ['==', ['get', 'adm3_pcode'], formattedCommune]);
        map.setFilter('commune-highlight-fill', ['==', ['get', 'adm3_pcode'], formattedCommune]);

        // Smart Zooming logic
        if (selectedVillageCode) {
            zoomToFeature(`KH${selectedVillageCode}`, selectedVillageCode, 14);
        } else if (formattedCommune !== 'NONE') {
            zoomToFeature(formattedCommune, selectedCommuneCode || '', 12);
        } else if (formattedDistrict !== 'NONE') {
            zoomToFeature(formattedDistrict, selectedDistrictCode || '', 10);
        } else if (formattedProvince !== 'NONE') {
            zoomToFeature(formattedProvince, selectedProvinceCode || '', 8);
        } else {
            // Zoom back out to whole country if nothing selected
            map.flyTo({ center: CAMBODIA_CENTER, zoom: 6.5, duration: 1500 });
        }

    }, [selectedProvinceCode, selectedDistrictCode, selectedCommuneCode, selectedVillageCode, isLoading, getGeometryBounds]);


    // Helper to zoom to a specific feature using our loaded centroids lookup
    const zoomToFeature = (pcode: string, rawCode: string, maxZoom: number) => {
        const map = mapRef.current;
        if (!map) return;

        // Try rawCode (custom location) first, then pcode (geojson)
        const center = centroidsRef.current[rawCode] || centroidsRef.current[pcode];
        if (center) {
            map.flyTo({ center, zoom: maxZoom, duration: 1500 });
        } else {
            // Fallback: If centroid not found, zoom out a bit to ensure it enters the viewport
            // This is unlikely if the geojson files match up, but a good fallback.
            console.warn(`Centroid not found for pcode: ${pcode} nor rawCode: ${rawCode}`);
        }
    };


    return (
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: '12px', overflow: 'hidden' }}>
            {isLoading && (
                <div style={{
                    position: 'absolute', inset: 0, zIndex: 10,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--color-surface)', color: 'var(--color-text-secondary)'
                }}>
                    <div className="loader" style={{ width: '24px', height: '24px', border: '2px solid transparent', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: '8px' }} />
                    កំពុងផ្ទុកផែនទី...
                </div>
            )}
            {error && (
                <div style={{
                    position: 'absolute', inset: 0, zIndex: 10,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--color-surface)', color: 'var(--color-error)'
                }}>
                    មានបញ្ហាក្នុងការផ្ទុកផែនទី
                </div>
            )}
            <div ref={mapContainerRef} style={{ width: '100%', height: '100%', background: '#e5e7eb' }} />
            <style>{`
                 .maplibregl-canvas:focus { outline: none; }
                 .maplibregl-ctrl-bottom-right { margin-bottom: 24px; margin-right: 24px; }
             `}</style>
        </div>
    );
};
