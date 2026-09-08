import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BrowserKeyboardHelpModal from '../BrowserKeyboardHelpModal.vue'

describe('BrowserKeyboardHelpModal', () => {
  // Task 36: Test keyboard shortcuts help modal (press ? to open)

  it('renders correctly when mounted', () => {
    const wrapper = mount(BrowserKeyboardHelpModal)
    expect(wrapper.exists()).toBe(true)
  })

  it('opens modal when ? key is pressed', async () => {
    const wrapper = mount(BrowserKeyboardHelpModal)

    const event = new KeyboardEvent('keydown', {
      key: '?',
      bubbles: true,
    })

    window.dispatchEvent(event)

    await wrapper.vm.$nextTick()
    expect(wrapper.find('.keyboard-help-overlay').exists()).toBe(true)
  })

  it('closes modal when escape key is pressed', async () => {
    const wrapper = mount(BrowserKeyboardHelpModal)

    // Open modal
    const questionEvent = new KeyboardEvent('keydown', {
      key: '?',
      bubbles: true,
    })
    window.dispatchEvent(questionEvent)
    await wrapper.vm.$nextTick()

    // Close with Escape
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    })
    window.dispatchEvent(escapeEvent)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.keyboard-help-overlay').exists()).toBe(false)
  })

  it('closes modal when close button is clicked', async () => {
    const wrapper = mount(BrowserKeyboardHelpModal)

    // Open modal
    const event = new KeyboardEvent('keydown', {
      key: '?',
      bubbles: true,
    })
    window.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    // Click close button
    await wrapper.find('.close-btn').trigger('click')

    expect(wrapper.find('.keyboard-help-overlay').exists()).toBe(false)
  })

  it('has proper ARIA attributes', async () => {
    const wrapper = mount(BrowserKeyboardHelpModal)

    // Open modal
    const event = new KeyboardEvent('keydown', {
      key: '?',
      bubbles: true,
    })
    window.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    const overlay = wrapper.find('.keyboard-help-overlay')
    expect(overlay.attributes('role')).toBe('dialog')
    expect(overlay.attributes('aria-modal')).toBe('true')
    expect(overlay.attributes('aria-labelledby')).toBe('shortcuts-title')
  })

  it('displays shortcut groups', async () => {
    const wrapper = mount(BrowserKeyboardHelpModal)

    // Open modal
    const event = new KeyboardEvent('keydown', {
      key: '?',
      bubbles: true,
    })
    window.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    const groups = wrapper.findAll('.shortcut-group')
    expect(groups.length).toBeGreaterThan(0)
  })
})
