/**
 * Visual testing helper for LiveSpec projects.
 * Provides regression detection (vs baseline) and design fidelity (vs Pencil mockup).
 *
 * Usage:
 *   import { compareRegression, compareDesign } from './visual'
 *
 *   // Regression check (2% threshold) — use in spec.check flows
 *   await compareRegression(page, 'login-default', { threshold: 0.02 })
 *
 *   // Design fidelity (5% threshold) — use in spec.test Phase 4.5.3
 *   await compareDesign(page, '.specs/design/screens/login.png', { threshold: 0.05 })
 *
 * Environment:
 *   LIVESPEC_FEATURE — feature ID for baseline routing (e.g., "001-auth")
 *                      Set by /spec.test and /spec.implement automatically.
 *                      If unset, derives from test file path (best-effort).
 */

import { Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IgnoreRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface RegressionOptions {
  /** Pixel difference threshold (0.0–1.0). Default: 0.02 (2%) */
  threshold?: number
  /** If true, overwrites the baseline with the current screenshot. Default: false */
  updateBaseline?: boolean
}

export interface DesignOptions {
  /** Pixel difference threshold (0.0–1.0). Default: 0.05 (5%) */
  threshold?: number
  /** Regions to exclude from comparison (dynamic content, timestamps, avatars) */
  ignoreRegions?: IgnoreRegion[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare the current page screenshot against a stored baseline.
 * Baseline dir: .specs/features/<test-suite>/baselines/
 * Diff output:  test-results/visual-diffs/<testName>/
 *
 * On first run (no baseline): saves the screenshot as the baseline and passes.
 * On subsequent runs: compares against baseline, throws on mismatch > threshold.
 *
 * @note Paths are resolved relative to process.cwd(). Run Playwright from the project root.
 */
export async function compareRegression(
  page: Page,
  testName: string,
  options: RegressionOptions = {}
): Promise<void> {
  const threshold = options.threshold ?? 0.02
  const updateBaseline = options.updateBaseline ?? false

  const baselineDir = path.join('.specs', 'features', _testSuiteName(), 'baselines')
  const baselinePath = path.join(baselineDir, `${testName}.png`)
  const diffDir = path.join('test-results', 'visual-diffs', testName)

  const actualBuffer = await page.screenshot({ fullPage: false })

  if (!fs.existsSync(baselinePath) || updateBaseline) {
    fs.mkdirSync(baselineDir, { recursive: true })
    fs.writeFileSync(baselinePath, actualBuffer)
    console.log(`[visual] Baseline saved: ${baselinePath}`)
    return
  }

  const result = await _pixelmatchDiff(actualBuffer, fs.readFileSync(baselinePath), {
    diffDir,
  })

  if (result.mismatch > threshold) {
    throw new Error(
      `[visual] Regression detected for "${testName}": ${(result.mismatch * 100).toFixed(2)}% diff (threshold: ${(threshold * 100).toFixed(2)}%)\n` +
      `  baseline: ${baselinePath}\n` +
      `  diff:     ${result.diffPath}\n` +
      `  actual:   ${result.actualPath}\n` +
      `Run with updateBaseline: true to accept the new appearance.`
    )
  }

  console.log(`[visual] Regression OK for "${testName}": ${(result.mismatch * 100).toFixed(2)}% diff`)
}

/**
 * Compare the current page screenshot against a Pencil mockup PNG.
 * Mockup path: .specs/design/screens/<screen-name>.png
 * Diff output: test-results/visual-diffs/<testName>-design/
 *
 * If mockupPath does not exist, logs a warning and skips (no error).
 * Throws on mismatch > threshold with paths to diff images.
 */
export async function compareDesign(
  page: Page,
  mockupPath: string,
  options: DesignOptions = {}
): Promise<void> {
  const threshold = options.threshold ?? 0.05
  const ignoreRegions = options.ignoreRegions ?? []

  if (!fs.existsSync(mockupPath)) {
    console.warn(`[visual] Design fidelity skipped — mockup not found: ${mockupPath}`)
    return
  }

  const testName = path.basename(mockupPath, '.png') + '-design'
  const diffDir = path.join('test-results', 'visual-diffs', testName)

  const actualBuffer = await page.screenshot({ fullPage: false })
  const mockupBuffer = fs.readFileSync(mockupPath)

  const result = await _pixelmatchDiff(actualBuffer, mockupBuffer, {
    diffDir,
    ignoreRegions,
  })

  if (result.mismatch > threshold) {
    throw new Error(
      `[visual] Design divergence for "${testName}": ${(result.mismatch * 100).toFixed(2)}% diff (threshold: ${(threshold * 100).toFixed(2)}%)\n` +
      `  mockup:   ${mockupPath}\n` +
      `  diff:     ${result.diffPath}\n` +
      `  actual:   ${result.actualPath}\n` +
      `Review the design diff and either fix the implementation or update the mockup.`
    )
  }

  console.log(`[visual] Design fidelity OK for "${testName}": ${(result.mismatch * 100).toFixed(2)}% diff`)
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

interface PixelmatchOptions {
  diffDir: string
  ignoreRegions?: IgnoreRegion[]
}

interface DiffResult {
  mismatch: number
  baselinePath: string
  diffPath: string
  actualPath: string
}

async function _pixelmatchDiff(
  actualBuffer: Buffer,
  expectedBuffer: Buffer,
  options: PixelmatchOptions
): Promise<DiffResult> {
  const { diffDir, ignoreRegions = [] } = options

  // Normalize both images to the same dimensions via sharp
  const [actualMeta, expectedMeta] = await Promise.all([
    sharp(actualBuffer).metadata(),
    sharp(expectedBuffer).metadata(),
  ])

  const width = Math.max(actualMeta.width ?? 0, expectedMeta.width ?? 0)
  const height = Math.max(actualMeta.height ?? 0, expectedMeta.height ?? 0)

  const [actualResized, expectedResized] = await Promise.all([
    sharp(actualBuffer).resize(width, height, { fit: 'contain', background: '#ffffff' }).png().toBuffer(),
    sharp(expectedBuffer).resize(width, height, { fit: 'contain', background: '#ffffff' }).png().toBuffer(),
  ])

  if (width === 0 || height === 0) {
    throw new Error('[visual] Could not compare images with zero width or height.')
  }

  const diffPng = new PNG({ width, height })

  // Write actual.png and baseline.png using the original (unmodified) resized buffers,
  // before any ignore-region mutations are applied.
  fs.mkdirSync(diffDir, { recursive: true })
  const baselinePath = path.join(diffDir, 'baseline.png')
  const diffPath = path.join(diffDir, 'diff.png')
  const actualPath = path.join(diffDir, 'actual.png')

  fs.writeFileSync(actualPath, actualResized)
  fs.writeFileSync(baselinePath, expectedResized)

  // Create separate copies for comparison so ignore-region mutations do not bleed
  // into the saved output images.
  const actualCmp = PNG.sync.read(actualResized)
  const expectedCmp = PNG.sync.read(expectedResized)

  if (ignoreRegions.length > 0) {
    _applyIgnoreRegions(actualCmp, expectedCmp, ignoreRegions)
  }

  // threshold: 0.1 is per-pixel color sensitivity — how different two neighboring pixels
  // must be in color space (0=identical, 1=maximum distance) before being counted as
  // mismatched. This is distinct from the caller's ratio threshold (% of total pixels
  // that may differ). 0.1 is the conventional default: strict enough to catch real
  // visual regressions while tolerating minor anti-aliasing differences.
  const mismatchPixels = pixelmatch(
    actualCmp.data,
    expectedCmp.data,
    diffPng.data,
    width,
    height,
    { threshold: 0.1, includeAA: false }
  )

  const totalPixels = width * height
  const mismatch = totalPixels > 0 ? mismatchPixels / totalPixels : 0

  // Save diff.png after pixelmatch populates diffPng.data
  fs.writeFileSync(diffPath, PNG.sync.write(diffPng))

  return { mismatch, baselinePath, diffPath, actualPath }
}

function _applyIgnoreRegions(actual: PNG, expected: PNG, regions: IgnoreRegion[]): void {
  for (const region of regions) {
    const yEnd = Math.min(region.y + region.height, actual.height)
    const xEnd = Math.min(region.x + region.width, actual.width)
    for (let y = Math.max(0, region.y); y < yEnd; y++) {
      for (let x = Math.max(0, region.x); x < xEnd; x++) {
        const idx = (y * actual.width + x) * 4
        // Zero out alpha channel — pixelmatch treats transparent pixels as equal
        actual.data[idx + 3] = 0
        expected.data[idx + 3] = 0
      }
    }
  }
}

function _testSuiteName(): string {
  // Primary: use LIVESPEC_FEATURE env var (set by /spec.test or /spec.implement)
  if (process.env.LIVESPEC_FEATURE) {
    return process.env.LIVESPEC_FEATURE.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  }
  // Fallback: derive from the calling test file path via stack trace
  const stack = new Error().stack ?? ''
  const match = stack.match(/at .+ \((.+\.(?:spec|test)\.[jt]s):\d+:\d+\)/)
  if (match) {
    const filename = path.basename(match[1]).replace(/\.(?:spec|test)\.[jt]s$/, '')
    console.warn(`[visual] LIVESPEC_FEATURE not set — deriving suite name from test file: "${filename}". Set LIVESPEC_FEATURE=<feature-id> for accurate baseline routing.`)
    return filename.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  }
  console.warn('[visual] LIVESPEC_FEATURE not set and could not derive suite name from stack. Baselines will be stored under "unknown". Set LIVESPEC_FEATURE=<feature-id>.')
  return 'unknown'
}
