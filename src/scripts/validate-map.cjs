/**
 * This script validates that every geographic polygon defined in the map data 
 * strongly correlates to a valid code within our central cambodia.json hierarchical dataset.
 * 
 * If a polygon on the map doesn't exist in cambodia.json, users cannot click it!
 */
const fs = require('fs');
const path = require('path');

const CAMBODIA_JSON_PATH = path.join(__dirname, '../data/cambodia.json');
const GEOJSON_DIR = path.join(__dirname, '../../public/data/geo');

function loadHierarchicalData() {
    const dict = JSON.parse(fs.readFileSync(CAMBODIA_JSON_PATH, 'utf8'));
    const provSet = new Set();
    const distSet = new Set();
    const commSet = new Set();

    for (const p of dict) {
        provSet.add(p.code);
        if (p.districts) {
            for (const d of p.districts) {
                distSet.add(d.code);
                if (d.communes) {
                    for (const c of d.communes) {
                        commSet.add(c.code);
                    }
                }
            }
        }
    }
    return { provSet, distSet, commSet };
}

function checkMismatches(geoFile, levelName, dictSet, propIdName) {
    const fullPath = path.join(GEOJSON_DIR, geoFile);
    if (!fs.existsSync(fullPath)) {
        console.warn(`[SKIP] Missing geojson file: ${geoFile}`);
        return 0;
    }

    const geo = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    let missing = [];

    for (const f of geo.features) {
        if (!f.properties[propIdName]) continue;
        const code = f.properties[propIdName].replace('KH', '');

        if (!dictSet.has(code)) {
            missing.push({
                code: code,
                en: f.properties[propIdName.replace('pcode', 'en')] || 'Unknown',
                km: f.properties[propIdName.replace('pcode', 'km')] || 'Unknown'
            });
        }
    }

    console.log(`--- ${levelName} Validation ---`);
    if (missing.length === 0) {
        console.log(`✅ SUCCESS: All ${geo.features.length} mapped ${levelName} polygons exist in cambodia.json.`);
    } else {
        console.error(`❌ ERROR: Found ${missing.length} unclickable mapped ${levelName} polygons missing from cambodia.json!`);
        missing.forEach(m => console.error(`    -> [${m.code}] ${m.en} / ${m.km}`));
    }
    return missing.length;
}

function runTests() {
    console.log('Validating Map Polygon clickability against cambodia.json...\n');
    const { provSet, distSet, commSet } = loadHierarchicalData();

    let totalErrors = 0;
    totalErrors += checkMismatches('khm_admin1.geojson', 'Province', provSet, 'adm1_pcode');
    console.log('');
    totalErrors += checkMismatches('khm_admin2.geojson', 'District', distSet, 'adm2_pcode');
    console.log('');
    totalErrors += checkMismatches('khm_admin3.geojson', 'Commune', commSet, 'adm3_pcode');
    console.log('');

    if (totalErrors > 0) {
        console.error(`\n🚨 FINAL RESULT: Validation FAILED with ${totalErrors} unclickable map polygons.`);
        process.exit(1);
    } else {
        console.log(`\n🎉 FINAL RESULT: Validation PASSED! All map polygons are fully clickable.`);
        process.exit(0);
    }
}

runTests();
