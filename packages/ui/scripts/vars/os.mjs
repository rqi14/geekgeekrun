import os from 'node:os'

export const currentOsPlatform = os.platform()
export const osPlatformToBuildCommandMap = {
  darwin: 'mac',
  linux: 'linux',
  win32: 'win'
}
export const buildTargetListMapByPlatform = {
  darwin: ['zip'],
  linux: ['AppImage'],
  win32: ['portable']
}
