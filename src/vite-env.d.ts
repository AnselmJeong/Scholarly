/// <reference types="vite/client" />

interface Window {
  ipcRenderer: {
    invoke<T = any>(channel: string, ...args: any[]): Promise<T>
    on(channel: string, listener: (event: any, ...args: any[]) => void): void
    off(channel: string, listener: (...args: any[]) => void): void
    send(channel: string, ...args: any[]): void
  }
}
