export const DEVTOOLS_STORAGE_KEY = 'geekgeekrun_devtools_open'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function shouldAutoOpenDevToolsOnStartup(storage: StorageLike = localStorage): boolean {
  return storage.getItem(DEVTOOLS_STORAGE_KEY) === 'true'
}

export function persistDevToolsState(isOpen: boolean, storage: StorageLike = localStorage): boolean {
  storage.setItem(DEVTOOLS_STORAGE_KEY, String(isOpen))
  return isOpen
}

export function nextDevToolsState(currentOpen: boolean, storage: StorageLike = localStorage): boolean {
  return persistDevToolsState(!currentOpen, storage)
}
