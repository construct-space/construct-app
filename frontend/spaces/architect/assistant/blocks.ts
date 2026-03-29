export interface ArchitectQuestionsBlock {
  type: 'architect:questions'
  data: {
    questions: Array<{
      id: string
      question: string
      type: 'single' | 'multi'
      options: Array<{ value: string; label: string; description?: string; icon?: string }>
    }>
  }
}

export interface ArchitectPlanBlock {
  type: 'architect:plan'
  data: {
    title: string
    summary: string
    decisions: Array<{ label: string; value: string }>
    docs: Array<{ path: string; title: string }>
    nextActions: Array<{ id: string; label: string }>
  }
}

export interface ArchitectProgressBlock {
  type: 'architect:progress'
  data: {
    message: string
  }
}

export type ArchitectBlock = ArchitectQuestionsBlock | ArchitectPlanBlock | ArchitectProgressBlock
