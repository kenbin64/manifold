#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MANIFOLD COMPILER — Generates game-manifold artifact
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Input: Game geometry definition (TypeScript)
 * Output: Compiled manifold artifact (JSON)
 *
 * This is the crucial step: dimensional collapse happens here.
 * Game logic definitions → single immutable manifold file
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const OUTPUT_DIR = path.join(__dirname, '..', 'core');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'game-manifold.json');

interface ManifoldArtifact {
  version: string;
  versionId: string;
  parent: string | null;
  dimensions: string[];
  coordinates: any;
  topology: string;
  checksum: string;
  compiledAt: number;
  dimensions_count: number;
}

/**
 * Compile game geometry to manifold artifact.
 *
 * This demonstrates dimensional compression:
 * - Input: Scattered game logic (rooms, players, boards, turns)
 * - Output: Single coordinate space (manifold)
 */
function compileManifold(): ManifoldArtifact {
  console.log('Compiling manifold...');

  // Define root game structure
  const coordinates = {
    game: {
      rooms: {},
      globals: {
        chat: [],
        leaderboard: [],
      },
      metadata: {
        createdAt: Date.now(),
        gameVersion: '1.0.0',
      },
    },
  };

  // Define dimensions
  const dimensions = [
    'game',
    'rooms',
    'players',
    'board',
    'cells',
    'pieces',
    'turn_order',
    'globals',
    'chat',
    'leaderboard',
  ];

  // Topology: Saddle geometry on board
  const topology = 'SaddleField [0°, 90°] at game.board.cells';

  // Generate checksum of coordinate structure
  const coordinateString = JSON.stringify(coordinates);
  const checksum = crypto.createHash('sha256').update(coordinateString).digest('hex');

  // Version management
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
  );

  const versionId = `v${packageJson.version}-${checksum.slice(0, 8)}`;

  const artifact: ManifoldArtifact = {
    version: packageJson.version,
    versionId,
    parent: null, // First version
    dimensions,
    coordinates,
    topology,
    checksum,
    compiledAt: Date.now(),
    dimensions_count: dimensions.length,
  };

  return artifact;
}

/**
 * Write artifact to disk.
 */
function writeArtifact(artifact: ManifoldArtifact): void {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write with indentation for readability
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(artifact, null, 2), 'utf-8');

  const size = fs.statSync(OUTPUT_FILE).size;
  console.log(`✓ Manifold artifact written: ${OUTPUT_FILE}`);
  console.log(`  Version: ${artifact.versionId}`);
  console.log(`  Dimensions: ${artifact.dimensions_count}`);
  console.log(`  Size: ${(size / 1024).toFixed(1)} KB`);
  console.log(`  Checksum: ${artifact.checksum.slice(0, 16)}...`);
}

/**
 * Main entry point.
 */
async function main() {
  try {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  MANIFOLD COMPILER — Dimensional Collapse                ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    // Compile
    const artifact = compileManifold();

    // Write
    writeArtifact(artifact);

    console.log(`\n✓ Compilation complete. Artifact ready for deployment.\n`);
  } catch (err) {
    console.error('✗ Compilation failed:', err);
    process.exit(1);
  }
}

main();
