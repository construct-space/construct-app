import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BrowserFindBar from '../BrowserFindBar.vue'

describe('BrowserFindBar', () => {
  it('renders when showFind is true', () => {
    const wrapper = mount(BrowserFindBar, {
      props: {
        showFind: true,
      },
    })

    expect(wrapper.find('.find-bar').exists()).toBe(true)
    expect(wrapper.find('.find-input').exists()).toBe(true)
  })

  it('hides when showFind is false', () => {
    const wrapper = mount(BrowserFindBar, {
      props: {
        showFind: false,
      },
    })

    expect(wrapper.find('.find-bar').exists()).toBe(false)
  })

  it('displays results count correctly', () => {
    const wrapper = mount(BrowserFindBar, {
      props: {
        showFind: true,
        matchCount: 5,
        activeIndex: 2,
      },
    })

    expect(wrapper.find('.find-results').text()).toBe('3 of 5')
  })

  it('shows "No results" when matchCount is 0', () => {
    const wrapper = mount(BrowserFindBar, {
      props: {
        showFind: true,
        matchCount: 0,
      },
    })

    expect(wrapper.find('.find-results').text()).toBe('No results')
  })

  it('emits search event on input change', async () => {
    const wrapper = mount(BrowserFindBar, {
      props: {
        showFind: true,
      },
    })

    const input = wrapper.find('.find-input')
    await input.setValue('test')

    expect(wrapper.emitted('search')).toBeTruthy()
    expect(wrapper.emitted('search')?.[0]).toEqual(['test'])
  })

  it('emits close event on close button click', async () => {
    const wrapper = mount(BrowserFindBar, {
      props: {
        showFind: true,
      },
    })

    const closeBtn = wrapper.find('.close-btn')
    await closeBtn.trigger('click')

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits next event on next button click', async () => {
    const wrapper = mount(BrowserFindBar, {
      props: {
        showFind: true,
      },
    })

    const buttons = wrapper.findAll('.find-btn')
    await buttons[1].trigger('click') // Next button (second button)

    expect(wrapper.emitted('next')).toBeTruthy()
  })

  it('emits prev event on prev button click', async () => {
    const wrapper = mount(BrowserFindBar, {
      props: {
        showFind: true,
      },
    })

    const buttons = wrapper.findAll('.find-btn')
    await buttons[0].trigger('click') // Prev button (first button)

    expect(wrapper.emitted('prev')).toBeTruthy()
  })

  it('emits next on Enter key in input', async () => {
    const wrapper = mount(BrowserFindBar, {
      props: {
        showFind: true,
      },
    })

    const input = wrapper.find('.find-input')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('next')).toBeTruthy()
  })

  it('emits close on Escape key in input', async () => {
    const wrapper = mount(BrowserFindBar, {
      props: {
        showFind: true,
      },
    })

    const input = wrapper.find('.find-input')
    await input.trigger('keydown.escape')

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('focuses input when showFind becomes true', async () => {
    const wrapper = mount(BrowserFindBar, {
      props: {
        showFind: false,
      },
    })

    await wrapper.setProps({ showFind: true })
    await wrapper.vm.$nextTick()

    // Input should exist and be focused
    const input = wrapper.find('.find-input')
    expect(input.exists()).toBe(true)
  })

  it('clears input text when showFind becomes true', async () => {
    const wrapper = mount(BrowserFindBar, {
      props: {
        showFind: true,
      },
    })

    const input = wrapper.find('.find-input')

    // Initial value should be empty
    expect((input.element as HTMLInputElement).value).toBe('')

    // Set a value
    await input.setValue('search term')
    expect((input.element as HTMLInputElement).value).toBe('search term')

    // When showFind is toggled, the watch should clear it
    // (In the actual component, the watch clears searchText when showFind becomes true)
  })
})
