export interface ApiResponse<T> {
  data: T
  message?: string
  status: string
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    total: number
    page: number
    page_size: number
    total_pages: number
  }
}

export interface Media {
  id: number
  filename: string
  original_filename: string
  mime_type: string
  size: number
  path: string
  url: string
  alt_text?: string
  description?: string
  created_at: string
  updated_at: string
}

export interface ApiError {
  message: string
  code?: string
  field?: string
  details?: Record<string, unknown>
}
