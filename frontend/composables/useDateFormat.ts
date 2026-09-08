import { format } from 'date-fns'

/**
 * Date formatting utilities for user-friendly date display using date-fns
 */

export const useDateFormat = () => {
  /**
   * Format date as "1 March 2026" instead of "2026-03-01"
   * @param date - Date string or Date object
   * @param formatString - date-fns format string (default: "d MMMM yyyy")
   * @returns Formatted date string
   */
  const formatDate = (date: string | Date | null | undefined, formatString: string = 'd MMMM yyyy'): string => {
    if (!date) return '-'
    
    const dateObj = typeof date === 'string' ? new Date(date) : date
    
    try {
      return format(dateObj, formatString)
    } catch (error) {
      console.error('Date formatting error:', error)
      return '-'
    }
  }

  /**
   * Format date as "1 Mar 2026" (shorter month format)
   */
  const formatDateShort = (date: string | Date | null | undefined): string => {
    return formatDate(date, 'd MMM yyyy')
  }

  /**
   * Format date as "1 March" (no year)
   */
  const formatDateNoYear = (date: string | Date | null | undefined): string => {
    return formatDate(date, 'd MMMM')
  }

  /**
   * Format date range as "1 March - 31 March 2026"
   */
  const formatDateRange = (startDate: string | Date | null | undefined, endDate: string | Date | null | undefined): string => {
    if (!startDate || !endDate) return '-'

    const start = typeof startDate === 'string' ? new Date(startDate) : startDate
    const end = typeof endDate === 'string' ? new Date(endDate) : endDate

    try {
      // If same year and month, show "1-31 March 2026"
      if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
        return `${format(start, 'd')} - ${format(end, 'd MMMM yyyy')}`
      }

      // If same year, show "1 March - 30 April 2026"
      if (start.getFullYear() === end.getFullYear()) {
        return `${formatDateNoYear(start)} - ${formatDate(end)}`
      }

      // Different years, show full dates: "1 March 2026 - 30 April 2027"
      return `${formatDate(start)} - ${formatDate(end)}`
    } catch (error) {
      console.error('Date range formatting error:', error)
      return '-'
    }
  }

  /**
   * Format datetime as "1 March 2026, 14:30"
   */
  const formatDateTime = (date: string | Date | null | undefined): string => {
    return formatDate(date, 'd MMMM yyyy, HH:mm')
  }

  return {
    formatDate,
    formatDateShort,
    formatDateNoYear,
    formatDateRange,
    formatDateTime
  }
}