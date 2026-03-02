import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Keep the code simple, just standard props for the component
interface CambodiaMapProps {
    selectedProvinceCode?: string;
    selectedDistrictCode?: string;
    selectedCommuneCode?: string;
    selectedVillageCode?: string;
    isEditing?: boolean;
    editMarkerLatLng?: [number, number] | null;
    onMapClick?: (lat: number, lng: number) => void;
    customLocations?: Array<{ pcode: string, lat: number, lng: number }>;
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
    customLocations = []
}) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);
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

        // Fetch centroids data for zooming
        fetch('/data/geo/khm_admincentroids.geojson')
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
                            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                            tileSize: 256,
                            attribution: '&copy; OpenStreetMap Contributors'
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
                // Add geojson sources
                map.addSource('provinces', { type: 'geojson', data: '/data/geo/khm_admin1.geojson' });
                map.addSource('districts', { type: 'geojson', data: '/data/geo/khm_admin2.geojson' });
                map.addSource('communes', { type: 'geojson', data: '/data/geo/khm_admin3.geojson' });

                // --- Base Layers ---
                map.addLayer({
                    id: 'province-base',
                    type: 'fill',
                    source: 'provinces',
                    paint: { 'fill-color': 'transparent' } // Keep source active for data queries
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

            map.on('error', (e) => {
                console.error("Maplibre init error:", e);
                setError("Failed to load map data");
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

    // Click Handler for Editing
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const handleClick = (e: maplibregl.MapMouseEvent) => {
            if (isEditing && onMapClick) {
                onMapClick(e.lngLat.lat, e.lngLat.lng);
            }
        };

        map.on('click', handleClick);

        // Change cursor
        map.getCanvas().style.cursor = isEditing ? 'crosshair' : '';

        return () => {
            map.off('click', handleClick);
        };
    }, [isEditing, onMapClick]);

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
