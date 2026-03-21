/**
 * Built-in space identifiers.
 *
 * Core spaces ship with the app and are loaded from src/spaces/ at compile time.
 * They don't need IIFE bundles or disk installation.
 */

import type { SpaceConfig } from '@/composables/useSpaces'

/** IDs of spaces that are bundled into the app */
export const BUILTIN_SPACE_IDS = ['vibe', 'architect', 'projects']

/** @deprecated Use BUILTIN_SPACE_IDS instead */
export const builtinSpaces: SpaceConfig[] = []

/** @deprecated Use BUILTIN_SPACE_IDS instead */
export const BUILTIN_SPACE_NAMES = builtinSpaces.map(s => s.name)
