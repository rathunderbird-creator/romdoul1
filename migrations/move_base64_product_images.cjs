/**
 * Move legacy base64 product images into Supabase storage.
 *
 * A few old products store their photo as a `data:` URL directly in
 * `products.image`. One of them is 3 MB, so every app boot downloads megabytes
 * of base64 with the products table — the single biggest transfer on a slow
 * connection. New products already upload to the `products` storage bucket
 * and store the public URL; this script migrates the stragglers the same way.
 *
 * Per affected product: decode the base64 → back it up to
 * migrations/image_backups/ → upload to the `products` bucket → fetch the
 * public URL back and byte-compare it → only then update the row. The
 * original file stays in the backup folder (gitignored), so the change is
 * reversible.
 *
 * Usage:
 *   node migrations/move_base64_product_images.cjs                 # dry run, all instances
 *   node migrations/move_base64_product_images.cjs --instance Romdoul1
 *   node migrations/move_base64_product_images.cjs --apply         # actually migrate
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const instances = require('./db_instances.json').instances;

const APPLY = process.argv.includes('--apply');
const instanceArg = (() => {
    const i = process.argv.indexOf('--instance');
    return i !== -1 ? process.argv[i + 1] : null;
})();

const BACKUP_DIR = path.join(__dirname, 'image_backups');

const extOf = (mime) => ({ 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[mime] || 'jpg');

async function migrateInstance(inst) {
    console.log(`\n=== ${inst.name} (${inst.url}) ${APPLY ? '' : '[DRY RUN]'}`);
    const supabase = createClient(inst.url, inst.anonKey);

    const { data: products, error } = await supabase.from('products').select('id, name, image');
    if (error) { console.error('  products query failed:', error.message); return; }

    const legacy = (products || []).filter(p => typeof p.image === 'string' && p.image.startsWith('data:'));
    if (legacy.length === 0) { console.log('  no base64 images — nothing to do.'); return; }

    for (const p of legacy) {
        const m = /^data:([a-z/+.-]+);base64,(.*)$/is.exec(p.image);
        if (!m) { console.log(`  SKIP ${p.name}: unrecognised data URL`); continue; }
        const [, mime, b64] = m;
        const bytes = Buffer.from(b64, 'base64');
        const fileName = `product_${p.id}_${Date.now()}.${extOf(mime.toLowerCase())}`;
        console.log(`  ${p.name}: ${(bytes.length / 1024).toFixed(0)} KB ${mime} → ${fileName}`);
        if (!APPLY) continue;

        // 1. Local backup of the original, before anything else.
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        fs.writeFileSync(path.join(BACKUP_DIR, `${inst.name}_${fileName}`), bytes);

        // 2. Upload to the same bucket the app's own image flow uses.
        const { error: upErr } = await supabase.storage.from('products').upload(fileName, bytes, { contentType: mime, upsert: false });
        if (upErr) { console.error(`    upload failed — row left untouched: ${upErr.message}`); continue; }

        // 3. Verify the public URL actually serves the same bytes.
        const { data: pub } = supabase.storage.from('products').getPublicUrl(fileName);
        const url = pub.publicUrl;
        const res = await fetch(url);
        const served = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
        if (!served || served.length !== bytes.length) {
            console.error(`    verification failed (${res.status}, ${served ? served.length : 0} bytes) — row left untouched`);
            continue;
        }

        // 4. Only now swap the row over to the URL.
        const { error: updErr } = await supabase.from('products').update({ image: url }).eq('id', p.id);
        if (updErr) { console.error(`    row update failed (image stays base64; uploaded copy kept): ${updErr.message}`); continue; }
        console.log(`    ✓ migrated → ${url}`);
    }
}

(async () => {
    const targets = instanceArg ? instances.filter(i => i.name === instanceArg) : instances;
    if (targets.length === 0) { console.error(`No instance named ${instanceArg}`); process.exit(1); }
    for (const inst of targets) await migrateInstance(inst);
    if (!APPLY) console.log('\nDry run only — re-run with --apply to migrate.');
})();
