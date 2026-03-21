/**
 * Conversations Store
 *
 * Manages chat conversations for the Architect space.
 * Wraps useContextDB conversation methods with reactive state.
 */
import { defineStore } from 'pinia'
import { useContextDB } from '@/composables/useContextDB'

export interface Conversation {
  id: string
  name: string
  model: string
  created_at: string
  updated_at: string
}

export const useConversationsStore = defineStore('conversations', () => {
  const conversations = ref<Conversation[]>([])
  const db = useContextDB()

  async function fetchConversations() {
    try {
      const result = await db.conversationList('architect')
      conversations.value = result.map(c => ({
        id: c.id,
        name: c.name,
        model: c.model,
        created_at: c.created_at,
        updated_at: c.updated_at,
      }))
      return { success: true }
    } catch (e) {
      console.error('[ConversationsStore] fetchConversations failed:', e)
      return { success: false, error: e }
    }
  }

  async function getConversation(id: string | number) {
    try {
      const conv = await db.conversationGet(String(id))
      return { success: true, data: conv }
    } catch (e) {
      return { success: false, error: e }
    }
  }

  async function getMessages(conversationId: string | number) {
    try {
      const conv = await db.conversationGet(String(conversationId))
      if (!conv?.messages_json) return { success: true, data: [] }
      const msgs = JSON.parse(conv.messages_json)
      return { success: true, data: msgs }
    } catch (e) {
      return { success: false, error: e }
    }
  }

  async function createConversation(data: { title: string; model?: string }) {
    try {
      const id = await db.conversationSave({
        context_key: 'architect',
        name: data.title,
        model: data.model || '',
      })
      if (id) {
        await fetchConversations()
        const conv = conversations.value.find(c => c.id === id)
        return { success: true, data: conv }
      }
      return { success: false, error: 'Failed to create' }
    } catch (e) {
      return { success: false, error: e }
    }
  }

  async function updateConversation(id: string | number, updates: Partial<Conversation>) {
    try {
      const conv = await db.conversationGet(String(id))
      if (conv) {
        await db.conversationSave({ ...conv, ...updates })
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: e }
    }
  }

  async function deleteConversation(id: string | number) {
    try {
      await db.conversationDelete(String(id))
      conversations.value = conversations.value.filter(c => c.id !== String(id))
      return { success: true }
    } catch (e) {
      return { success: false, error: e }
    }
  }

  async function addMessage(conversationId: string | number, message: { role: string; content: string }) {
    try {
      const conv = await db.conversationGet(String(conversationId))
      if (conv) {
        const messages = conv.messages_json ? JSON.parse(conv.messages_json) : []
        messages.push(message)
        await db.conversationSave({ ...conv, messages_json: JSON.stringify(messages) })
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: e }
    }
  }

  return {
    conversations,
    fetchConversations,
    getConversation,
    getMessages,
    createConversation,
    updateConversation,
    deleteConversation,
    addMessage,
  }
})
