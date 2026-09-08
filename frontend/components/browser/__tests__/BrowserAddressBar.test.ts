import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BrowserAddressBar from '../BrowserAddressBar.vue'

describe('BrowserAddressBar', () => {
  it('keeps typed text in the input and emits the typed address', async () => {
    const wrapper = mount(BrowserAddressBar, {
      props: {
        address: 'https://construct.space',
      },
    })

    const input = wrapper.find('input')
    await input.setValue('https://example.com')

    expect((input.element as HTMLInputElement).value).toBe('https://example.com')
    expect(wrapper.emitted('update:address')?.at(-1)).toEqual(['https://example.com'])
  })

  it('does not overwrite typed text from prop updates while focused', async () => {
    const wrapper = mount(BrowserAddressBar, {
      props: {
        address: 'https://construct.space',
      },
    })

    const input = wrapper.find('input')
    await input.trigger('focus')
    await input.setValue('https://example.com')
    await wrapper.setProps({ address: 'https://construct.space/updated-by-page-state' })

    expect((input.element as HTMLInputElement).value).toBe('https://example.com')
  })
})
