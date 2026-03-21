export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'mention' | 'activity' | 'task'

export interface Notification {
  id: number
  user_id: number
  title: string
  body: string
  type: NotificationType
  read: boolean
  read_at: string | null
  action_url: string | null
  created_at: string
  updated_at: string
}

export interface UpdateNotificationRequest {
  read?: boolean
  read_at?: string | null
}

export interface NotificationWSMessage {
  type: 'notification.new' | 'notification.updated' | 'notification.deleted'
  content: Notification | { id: number }
  room: string
  nickname: string
}
