import { describe, expect, it } from 'vitest'
import {
  getErrorActions,
  detectErrorPhase,
  type SpaceLoadErrorPhase,
} from '../errorActions'

describe('validation', () => {
  // ---------------------------------------------------------------------------
  // getErrorActions — error phase to actionable suggestion mapping
  // ---------------------------------------------------------------------------

  describe('getErrorActions', () => {
    it('returns re-download action for checksum_mismatch', () => {
      const actions = getErrorActions('checksum_mismatch')
      expect(actions.length).toBeGreaterThanOrEqual(1)
      expect(actions[0].label).toContain('Re-download')
      expect(actions[0].route).toBe('/app/marketplace')
      expect(actions[0].type).toBe('navigate')
    })

    it('returns update actions for version_incompatible', () => {
      const actions = getErrorActions('version_incompatible')
      expect(actions.length).toBeGreaterThanOrEqual(2)
      expect(actions.some(a => a.label.includes('Update Construct'))).toBe(true)
      expect(actions.some(a => a.label.includes('Update space'))).toBe(true)
    })

    it('returns re-install action for missing_bundle', () => {
      const actions = getErrorActions('missing_bundle')
      expect(actions.length).toBeGreaterThanOrEqual(1)
      expect(actions[0].label).toContain('Re-install')
      expect(actions[0].route).toBe('/app/marketplace')
    })

    it('returns re-install action for missing_manifest', () => {
      const actions = getErrorActions('missing_manifest')
      expect(actions.length).toBeGreaterThanOrEqual(1)
      expect(actions[0].label).toContain('Re-install')
    })

    it('returns validate command for agent_config_missing', () => {
      const actions = getErrorActions('agent_config_missing')
      expect(actions.length).toBeGreaterThanOrEqual(1)
      expect(actions[0].label).toContain('construct validate')
      expect(actions[0].type).toBe('command')
      expect(actions[0].command).toBe('construct validate')
    })

    it('returns re-install and report for eval_failed', () => {
      const actions = getErrorActions('eval_failed')
      expect(actions.length).toBeGreaterThanOrEqual(2)
      expect(actions[0].label).toContain('Re-install')
      expect(actions[1].label).toContain('Report')
    })

    it('returns re-install for no_pages_exported', () => {
      const actions = getErrorActions('no_pages_exported')
      expect(actions.length).toBeGreaterThanOrEqual(1)
      expect(actions[0].label).toContain('Re-install')
    })

    it('returns reload for css_injection_failed', () => {
      const actions = getErrorActions('css_injection_failed')
      expect(actions.length).toBeGreaterThanOrEqual(1)
      expect(actions[0].label).toContain('Reload')
      expect(actions[0].type).toBe('command')
    })

    it('returns permission check for disk_read_failed', () => {
      const actions = getErrorActions('disk_read_failed')
      expect(actions.length).toBeGreaterThanOrEqual(1)
      expect(actions[0].label).toContain('permissions')
    })

    it('returns enable action for disabled', () => {
      const actions = getErrorActions('disabled')
      expect(actions.length).toBeGreaterThanOrEqual(1)
      expect(actions[0].label).toContain('Enable')
      expect(actions[0].route).toBe('/app/settings/spaces')
    })

    it('returns fallback actions for unknown phase', () => {
      const actions = getErrorActions('unknown')
      expect(actions.length).toBeGreaterThanOrEqual(1)
      // Should still provide some helpful actions
      expect(actions.some(a => a.route)).toBe(true)
    })

    it('all actions have required fields', () => {
      const phases: SpaceLoadErrorPhase[] = [
        'checksum_mismatch',
        'version_incompatible',
        'missing_bundle',
        'missing_manifest',
        'agent_config_missing',
        'eval_failed',
        'no_pages_exported',
        'css_injection_failed',
        'disk_read_failed',
        'disabled',
        'unknown',
      ]

      for (const phase of phases) {
        const actions = getErrorActions(phase)
        expect(actions.length).toBeGreaterThan(0)
        for (const action of actions) {
          expect(action.label).toBeTruthy()
          expect(action.description).toBeTruthy()
          expect(['navigate', 'command', 'info']).toContain(action.type)
        }
      }
    })
  })

  // ---------------------------------------------------------------------------
  // detectErrorPhase — classify error messages into phases
  // ---------------------------------------------------------------------------

  describe('detectErrorPhase', () => {
    it('detects checksum_mismatch', () => {
      expect(detectErrorPhase('Checksum mismatch for "my-space"')).toBe('checksum_mismatch')
      expect(detectErrorPhase('Bundle integrity check failed')).toBe('checksum_mismatch')
    })

    it('detects version_incompatible', () => {
      expect(detectErrorPhase('Version incompatible with host')).toBe('version_incompatible')
      expect(detectErrorPhase('hostApiVersion 2.0.0 required')).toBe('version_incompatible')
    })

    it('detects missing_bundle', () => {
      expect(detectErrorPhase('Bundle file not found')).toBe('missing_bundle')
      expect(detectErrorPhase('Missing bundle at /path/to/space.iife.js')).toBe('missing_bundle')
    })

    it('detects missing_manifest', () => {
      expect(detectErrorPhase('Manifest not found in space directory')).toBe('missing_manifest')
      expect(detectErrorPhase('manifest.json missing')).toBe('missing_manifest')
    })

    it('detects agent_config_missing', () => {
      expect(detectErrorPhase('Agent config file is missing')).toBe('agent_config_missing')
    })

    it('detects eval_failed', () => {
      expect(detectErrorPhase('Failed to eval space bundle')).toBe('eval_failed')
      expect(detectErrorPhase('SyntaxError in space code')).toBe('eval_failed')
      expect(detectErrorPhase('Failed to execute space bundle')).toBe('eval_failed')
    })

    it('detects disk_read_failed', () => {
      expect(detectErrorPhase('Permission denied reading space files')).toBe('disk_read_failed')
      expect(detectErrorPhase('EACCES: no read access')).toBe('disk_read_failed')
    })

    it('detects disabled', () => {
      expect(detectErrorPhase('Space "my-space" is disabled')).toBe('disabled')
    })

    it('returns unknown for unrecognized messages', () => {
      expect(detectErrorPhase('Something weird happened')).toBe('unknown')
      expect(detectErrorPhase('')).toBe('unknown')
    })
  })
})
