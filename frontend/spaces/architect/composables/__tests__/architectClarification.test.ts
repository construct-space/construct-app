import { describe, expect, it } from 'vitest'

import { isLikelyClarificationQuestion } from '../architectClarification'
import type { InterviewQuestion } from '../../data/architect-knowledge'

const frontendQuestion: InterviewQuestion = {
  id: 'frontend',
  type: 'single',
  question: 'What platform should we build for first?',
  options: [
    { value: 'flutter', label: 'Flutter', icon: 'i-simple-icons-flutter', description: 'Cross-platform mobile UI toolkit' },
    { value: 'react-native', label: 'React Native', icon: 'i-simple-icons-react', description: 'React-based mobile app framework' },
  ],
}

describe('architect clarification detection', () => {
  it('detects direct clarification questions', () => {
    expect(isLikelyClarificationQuestion('Why ask for platform when I said Flutter', frontendQuestion)).toBe(true)
    expect(isLikelyClarificationQuestion('What do you mean by initial launch size?', frontendQuestion)).toBe(true)
    expect(isLikelyClarificationQuestion('Flutter?', frontendQuestion)).toBe(true)
  })

  it('does not treat option selections as clarification questions', () => {
    expect(isLikelyClarificationQuestion('flutter', frontendQuestion)).toBe(false)
    expect(isLikelyClarificationQuestion('Flutter', frontendQuestion)).toBe(false)
    expect(isLikelyClarificationQuestion('react-native', frontendQuestion)).toBe(false)
  })
})
