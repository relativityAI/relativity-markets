"use client"

import {
  ColorModeProvider,
  type ColorModeProviderProps,
} from "./color-mode"

/** App-level provider: next-themes only — the Chakra runtime is gone. */
export function Provider(props: ColorModeProviderProps) {
  return <ColorModeProvider {...props} />
}
