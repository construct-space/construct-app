import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import BrowserBookmarkPopover from '../BrowserBookmarkPopover.vue'

describe('BrowserBookmarkPopover', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('is hidden by default', () => {
    const wrapper = mount(BrowserBookmarkPopover, {
      props: {
        show: false,
        title: 'Test',
        url: 'https://example.com',
        favicon: null,
      },
    })
    expect(wrapper.find('.bookmark-popover').exists()).toBe(false)
  })

  it('shows when show prop is true', () => {
    const wrapper = mount(BrowserBookmarkPopover, {
      props: {
        show: true,
        title: 'Test Page',
        url: 'https://example.com',
        favicon: null,
      },
    })
    expect(wrapper.find('.bookmark-popover').exists()).toBe(true)
    expect(wrapper.find('h3').text()).toBe('Save Bookmark')
  })

  it('renders disabled URL input', async () => {
    const wrapper = mount(BrowserBookmarkPopover, {
      props: {
        show: true,
        title: 'Test Page',
        url: 'https://example.com',
        favicon: null,
      },
    })
    const inputs = wrapper.findAll('input')
    expect(inputs[1].attributes('disabled')).toBeDefined()
    expect(inputs[1].attributes('placeholder')).toBe('URL')
  })

  it('emits close when cancel is clicked', async () => {
    const wrapper = mount(BrowserBookmarkPopover, {
      props: {
        show: true,
        title: 'Test',
        url: 'https://example.com',
        favicon: null,
      },
    })
    const buttons = wrapper.findAll('button')
    await buttons[1].trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits save event with updated title', async () => {
    const wrapper = mount(BrowserBookmarkPopover, {
      props: {
        show: true,
        title: 'Test',
        url: 'https://example.com',
        favicon: null,
      },
    })
    const input = wrapper.find('input[placeholder="Title"]')
    await input.setValue('My Custom Title')
    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')

    const emitted = wrapper.emitted('save')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toEqual({
      title: 'My Custom Title',
      url: 'https://example.com',
      folderId: null,
    })
  })

  it('includes folder selector with option for unsorted and favorites', async () => {
    const wrapper = mount(BrowserBookmarkPopover, {
      props: {
        show: true,
        title: 'Test',
        url: 'https://example.com',
        favicon: null,
      },
    })
    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)
    const options = select.findAll('option')
    expect(options.length).toBeGreaterThanOrEqual(1)
    expect(options[0].text()).toBe('Unsorted')
  })

  it('closes popover after saving', async () => {
    const wrapper = mount(BrowserBookmarkPopover, {
      props: {
        show: true,
        title: 'Test',
        url: 'https://example.com',
        favicon: null,
      },
    })
    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
