import { useCallback, useState } from 'react'

export const MAX_BULK_DOWNLOAD_CASES = 20

/** Select-mode + selected id set shared by the client, ops and admin case lists. */
export function useBulkSelection(max = MAX_BULK_DOWNLOAD_CASES) {
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < max) next.add(id)
      return next
    })
  }, [max])

  const setAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids.slice(0, max)))
  }, [max])

  const clear = useCallback(() => setSelected(new Set()), [])
  const exit = useCallback(() => { setSelectMode(false); setSelected(new Set()) }, [])

  return { selectMode, setSelectMode, selected, toggle, setAll, clear, exit, max }
}
