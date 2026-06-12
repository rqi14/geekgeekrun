import verifyNativeModules from './steps/verify-native-modules.mjs'

const ok = verifyNativeModules()
process.exit(ok ? 0 : 1)
