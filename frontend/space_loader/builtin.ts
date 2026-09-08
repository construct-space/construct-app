/**
 * Built-in space identifiers.
 *
 * Re-exports the canonical list from types/space.ts.
 * Host-native spaces ship with the app and are loaded from
 * `space_loader/coreSpaces.ts` at compile time. They don't need
 * IIFE bundles or disk installation.
 *
 * There are exactly 4 host-native spaces: architect, ask, coder, project.
 */

import { HOST_NATIVE_SPACE_IDS } from '../types/space'

/**
 * IDs of spaces that are bundled into the app.
 * Derived from the single source of truth in types/space.ts.
 */
export const BUILTIN_SPACE_IDS: readonly string[] = HOST_NATIVE_SPACE_IDS
