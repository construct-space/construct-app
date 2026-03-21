export interface TranslatableField {
  key: string
  label: string
  type: 'input' | 'textarea'
  required?: boolean
  rows?: number
}

export type SupportedLanguage = 'de' | 'fr' | 'it' | 'en'