export {};

declare global {
  interface Window {
    SteamClient?: any;
    appDetailsStore?: any;
    Router?: any;
    __armadaQamProfileFixObserver?: MutationObserver;
  }
}
