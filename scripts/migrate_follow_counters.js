// signaling_server/scripts/migrate_follow_counters.js
//
// 🎯 BUT: Initialiser followersCount=0 et followingCount=0 sur tous les users
//         Firestore qui n'ont pas encore ces champs.
//
// 📦 PRÉREQUIS:
//   - Le fichier signaling_server/firebase-admin.json doit exister
//     OU la variable d'env FIREBASE_ADMIN_JSON doit être définie
//
// 🚀 LANCEMENT:
//   cd signaling_server
//   node scripts/migrate_follow_counters.js
//
// ⚠️  À LANCER UNE SEULE FOIS (idempotent : ré-exécuter ne fait rien de mal,
//     mais c'est inutile car les users déjà migrés sont skippés).

'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────────────────────────────
// 🔐 Chargement des credentials Firebase Admin
// ──────────────────────────────────────────────────────────────────────

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function loadServiceAccount() {
  const envJson = process.env.FIREBASE_ADMIN_JSON;
  if (envJson && envJson.trim()) {
    const parsed = safeJsonParse(envJson);
    if (parsed && typeof parsed === 'object') {
      console.log('🔐 Credentials chargés depuis FIREBASE_ADMIN_JSON');
      return parsed;
    }
    throw new Error('FIREBASE_ADMIN_JSON existe mais JSON invalide.');
  }

  const localPath = path.join(__dirname, '..', 'firebase-admin.json');
  if (fs.existsSync(localPath)) {
    const raw = fs.readFileSync(localPath, 'utf8');
    const parsed = safeJsonParse(raw);
    if (parsed && typeof parsed === 'object') {
      console.log('🔐 Credentials chargés depuis firebase-admin.json');
      return parsed;
    }
    throw new Error('firebase-admin.json existe mais JSON invalide.');
  }

  return null;
}

const serviceAccount = loadServiceAccount();

if (!serviceAccount) {
  console.error(
    '❌ Aucun credential Firebase trouvé.\n' +
      '   Définissez FIREBASE_ADMIN_JSON ou créez signaling_server/firebase-admin.json'
  );
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ──────────────────────────────────────────────────────────────────────
// 🔄 MIGRATION
// ──────────────────────────────────────────────────────────────────────

async function migrate() {
  console.log('');
  console.log('🔄 ═══════════════════════════════════════════════════════');
  console.log('🔄  MIGRATION : Initialisation des compteurs follow');
  console.log('🔄 ═══════════════════════════════════════════════════════');
  console.log('');

  const startTime = Date.now();

  // 1. Récupère TOUS les users
  console.log('📥 Récupération de tous les users Firestore...');
  const snap = await db.collection('users').get();
  console.log(`📊 ${snap.size} users trouvés dans Firestore`);
  console.log('');

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // 2. Traite par batch de 400 (limite Firestore = 500 ops/batch)
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let inBatch = 0;
  let batchNumber = 1;

  for (const doc of snap.docs) {
    try {
      const data = doc.data() || {};
      const updates = {};

      if (typeof data.followersCount !== 'number') {
        updates.followersCount = 0;
      }
      if (typeof data.followingCount !== 'number') {
        updates.followingCount = 0;
      }

      // Déjà migré → skip
      if (Object.keys(updates).length === 0) {
        skipped++;
        continue;
      }

      batch.set(doc.ref, updates, { merge: true });
      inBatch++;
      updated++;

      // Commit le batch quand plein
      if (inBatch >= BATCH_SIZE) {
        await batch.commit();
        console.log(
          `  ✅ Batch #${batchNumber} commité (${inBatch} users) — total mis à jour: ${updated}`
        );
        batch = db.batch();
        inBatch = 0;
        batchNumber++;
      }
    } catch (e) {
      errors++;
      console.error(`  ⚠️  Erreur sur user ${doc.id}: ${e.message}`);
    }
  }

  // Commit le dernier batch (incomplet)
  if (inBatch > 0) {
    await batch.commit();
    console.log(
      `  ✅ Batch final #${batchNumber} commité (${inBatch} users) — total mis à jour: ${updated}`
    );
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('');
  console.log('🔄 ═══════════════════════════════════════════════════════');
  console.log('✅  MIGRATION TERMINÉE');
  console.log('🔄 ═══════════════════════════════════════════════════════');
  console.log(`📊 Total users analysés    : ${snap.size}`);
  console.log(`✅ Users mis à jour         : ${updated}`);
  console.log(`⏭️  Users déjà OK (skip)    : ${skipped}`);
  console.log(`❌ Erreurs                  : ${errors}`);
  console.log(`⏱️  Durée totale            : ${elapsed}s`);
  console.log('🔄 ═══════════════════════════════════════════════════════');
  console.log('');

  process.exit(errors > 0 ? 1 : 0);
}

migrate().catch((e) => {
  console.error('');
  console.error('❌ ═══════════════════════════════════════════════════════');
  console.error('❌  ERREUR FATALE');
  console.error('❌ ═══════════════════════════════════════════════════════');
  console.error(e);
  console.error('');
  process.exit(1);
});