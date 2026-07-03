import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/**
 * Runs `handler` on Android hardware back while `enabled`. Return-true
 * semantics are implied: while enabled, back is consumed by the handler.
 * Handlers registered later win (RN dispatches LIFO), so a form screen
 * mounted inside a group screen takes priority automatically.
 */
export function useBackHandler(enabled: boolean, handler: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handler();
      return true;
    });
    return () => sub.remove();
  }, [enabled, handler]);
}
